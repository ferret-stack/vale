/**
 * 08_Send.gs  [LIBRARY] — §8 "Run behaviour", Addendum v1 §1b/§1c.
 *
 * sendBatch_(rows, stage, mode) is still the ONLY place mail leaves this
 * project (§9.6). Phase 2's trigger must call this same function, not a copy.
 *
 * ADDENDUM v1 — the confirmation flow is now two server calls, not one:
 *
 *   startSendFlow_(stage)
 *     → preflight, evaluate the queue, apply cap/quota
 *     → LIVE only: native recipient-count confirmation (unchanged, §5)
 *     → opens SendPreview.html as a modal dialog showing the first message
 *       rendered as real HTML
 *   executeConfirmedSend(stage, fingerprint)   [called by that dialog]
 *     → re-evaluates from scratch, refuses if the plan changed, then sends
 *
 * The split exists because Ui.alert() cannot render HTML, so the message
 * preview had to become an HtmlService surface — and an HtmlService dialog
 * cannot return a value to the call that opened it. Nothing is carried between
 * the two calls except a fingerprint of the plan, which the second call
 * recomputes and compares. There is no cached state to go stale.
 *
 * The LIVE confirmation runs BEFORE the preview rather than after it, which is
 * the reverse of the v1 order. Two dialogs cannot be stacked — a native alert
 * raised while a modal dialog is open is not reliably visible — so one of them
 * had to move. The message preview is the one that belongs immediately before
 * the send, so the count confirmation went first.
 */

/**
 * MULTI-BDM CHANGE — the operator CC (Dev Log 2026-09-11, Theme A: "test-mode
 * sends CC the operator's own address. Live sends unaffected.").
 *
 * Library-level and operator-owned, deliberately NOT an Engine row: an Engine
 * row is a cell a BDM can edit, and the point of this address is that the
 * operator sees the test traffic whether or not the BDM wants them to. Setting
 * it here also means it is set once for the whole fleet rather than three
 * times, and a BDM cannot remove themselves from operator oversight by
 * clearing a cell.
 *
 * >>> SET THIS BEFORE PUBLISHING THE LIBRARY VERSION. <<<
 * Shipped blank on purpose. A blank value disables the CC and changes nothing
 * about how mail is sent; it does not error, and it does not block a run. It is
 * blank rather than pre-filled because the wrong address here is worse than
 * none: it silently CCs a stranger on every test send, and nothing in the
 * system would report it.
 *
 * Applied in ONE place — the opts object built inside sendBatch_() — and
 * guarded there by `mode === MODE.TEST`. sendBatch_() is the only function in
 * the project that hands anything to Gmail (§9.6), so that single guard is the
 * whole of the live-path exclusion: there is no second send path for it to leak
 * through, and sendBatch_() re-reads Engine!MODE and refuses to run if it
 * disagrees with the mode it was passed, so the guard cannot be reached with a
 * stale mode.
 */
var OPERATOR_CC = '';

/**
 * The CC that will actually be applied for a mode.
 * LIVE returns '' unconditionally — the mode check lives here, in one
 * expression, rather than being restated at the call site.
 */
function operatorCcFor_(mode) {
  return (mode === MODE.TEST) ? trim_(OPERATOR_CC) : '';
}

function sendBatchFromMenu() {
  var stage = promptStage_();
  if (stage === null) return;
  var r = startSendFlow_(stage);
  if (!r.opened && r.message) alert_(r.title || 'Nothing sent', r.message);
}

/**
 * Stage one of two. Everything up to, but not including, mail moving.
 * Returns { opened: bool, title?, message? }. Throws on config/template faults.
 */
function startSendFlow_(stage) {
  var plan = buildSendPlan_(stage);
  if (plan.blocked) return { opened: false, title: plan.blockedTitle, message: plan.blockedBody };

  // Second hard stop for LIVE, naming the exact recipient count (§5).
  // Stays a native dialog: it is a number, there is nothing to render.
  if (plan.mode === MODE.LIVE) {
    if (!confirm_('LIVE MODE',
      'This will send ' + plan.toSend.length + ' real email(s) to ' + plan.toSend.length +
      ' real recipient(s) at stage ' + stage + '.\n\n' +
      'You will see the first message in full before it goes.\n\nContinue?')) {
      return { opened: false, title: 'Cancelled', message: 'Nothing was sent.' };
    }
  }

  showSendPreviewDialog_(plan);
  return { opened: true };
}

/**
 * Everything needed to decide whether to send, and to show what will be sent.
 * Writes nothing. Deterministic given the sheet state, which is what makes the
 * fingerprint meaningful.
 */
function buildSendPlan_(stage) {
  var cfg = readEngine_();
  var mode = engineMode_(cfg);

  var problems = engineProblems_(cfg, mode);
  if (problems.length) {
    throw new Error('Cannot send:\n\n  • ' + problems.join('\n  • '));
  }
  var template = activeTemplate_(stage);

  var idx = buildProspectIndex_();
  var res = evaluateQueue_(stage, template, idx);

  if (!res.eligible.length && !res.invalid.length) {
    return { blocked: true, blockedTitle: 'Nothing to send',
      blockedBody: 'No queue rows for stage ' + stage + ' have Send? = Y with a blank Status.\n\n' +
        'Not gated (Send? not Y): ' + res.notGated +
        (res.otherStage ? '\nStaged for another stage: ' + res.otherStage : '') };
  }

  var cap = engineMaxSends_(cfg);
  var quota = MailApp.getRemainingDailyQuota();
  var limit = Math.min(cap, quota);
  var toSend = res.eligible.slice(0, limit);
  var heldBack = res.eligible.length - toSend.length;
  var heldReason = (quota < cap && quota < res.eligible.length) ? 'Gmail daily quota' : 'MAX_SENDS_PER_RUN';

  if (!toSend.length) {
    return { blocked: true, blockedTitle: 'Nothing can be sent',
      blockedBody: res.eligible.length + ' row(s) are eligible but the limit is 0 ' +
        '(remaining Gmail quota today: ' + quota + ', MAX_SENDS_PER_RUN: ' + cap + ').' };
  }

  var preview;
  try {
    preview = render_(template, toSend[0].fields, cfg.SIGNATURE_BLOCK);
  } catch (e) {
    throw new Error('The first eligible row cannot be rendered: ' + e.message);
  }

  return {
    blocked: false,
    stage: stage,
    mode: mode,
    templateName: template.name,
    toSend: toSend,
    res: res,
    heldBack: heldBack,
    heldReason: heldReason,
    cap: cap,
    quota: quota,
    firstRecipient: (mode === MODE.TEST) ? trim_(cfg.TEST_EMAIL) : toSend[0].email,
    firstIntended: toSend[0].email,
    firstSubject: (mode === MODE.TEST) ? testSubject_(preview.subject, toSend[0].email) : preview.subject,
    // Shown in the preview so the CC is visible BEFORE anything sends, rather
    // than being discovered afterwards in the operator's own inbox. '' in LIVE.
    ccRecipient: operatorCcFor_(mode),
    previewHtml: preview.html,
    fingerprint: planFingerprint_(stage, mode, res, toSend)
  };
}

/**
 * Identity of a plan: mode, stage, and exactly which queue rows and addresses
 * are about to be sent to or skipped. Any edit to the queue between preview
 * and confirm changes this, and the send is refused rather than sending
 * something other than what was shown.
 */
function planFingerprint_(stage, mode, res, toSend) {
  function part(items) {
    return items.map(function (it) { return it.rowNum + ':' + normEmail_(it.email); }).join(',');
  }
  var raw = mode + '|' + stage + '|SEND=' + part(toSend) + '|SKIP=' + part(res.invalid);
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8));
}

/** Opens the HTML preview. Data is templated in — no second evaluation pass. */
function showSendPreviewDialog_(plan) {
  var t = HtmlService.createTemplateFromFile('SendPreview');
  t.payload = JSON.stringify({
    stage: plan.stage,
    mode: plan.mode,
    templateName: plan.templateName,
    sendCount: plan.toSend.length,
    skipCount: plan.res.invalid.length,
    heldBack: plan.heldBack,
    heldReason: plan.heldReason,
    firstRecipient: plan.firstRecipient,
    firstIntended: plan.firstIntended,
    firstSubject: plan.firstSubject,
    ccRecipient: plan.ccRecipient,
    previewHtml: plan.previewHtml,
    fingerprint: plan.fingerprint
  });
  SpreadsheetApp.getUi().showModalDialog(
    t.evaluate().setWidth(760).setHeight(660),
    'Send Batch — confirm');
}

/**
 * Stage two of two. Called by SendPreview.html only, after the operator has
 * seen the rendered message. Re-evaluates everything; the fingerprint is the
 * only thing carried across.
 */
function executeConfirmedSend(stage, fingerprint) {
  var plan = buildSendPlan_(stage);
  if (plan.blocked) throw new Error(plan.blockedTitle + ': ' + plan.blockedBody);

  if (plan.fingerprint !== fingerprint) {
    throw new Error('The Send Queue changed since this preview was generated. ' +
      'Nothing was sent. Close this window and run Send Batch again.');
  }

  // Mark skips only now that the operator has committed.
  plan.res.invalid.forEach(function (it) {
    writeQueueFields_(plan.res.qsh, plan.res.qmap, it.rowNum, {
      'Status': STATUS.SKIPPED,
      'Stage': stage,
      'Notes': 'SKIPPED — ' + it.reason
    });
  });
  SpreadsheetApp.flush();

  var outcome = sendBatch_(plan.toSend, stage, plan.mode);

  outcome.skipped = plan.res.invalid.length;
  outcome.evaluated = plan.res.eligible.length + plan.res.invalid.length;
  outcome.heldBack = plan.heldBack + outcome.notReached;
  outcome.stage = stage;
  outcome.mode = plan.mode;
  outcome.quotaRemaining = MailApp.getRemainingDailyQuota();

  writeRunLog_(outcome);

  return {
    sent: outcome.sent, skipped: outcome.skipped, failed: outcome.failed,
    unlinked: outcome.unlinked, heldBack: outcome.heldBack,
    quotaRemaining: outcome.quotaRemaining,
    summary: summaryText_(outcome, plan.heldReason)
  };
}

function testSubject_(subject, intendedEmail) {
  return '[TEST → ' + intendedEmail + '] ' + subject;
}

/**
 * THE send function. rows = items from evaluateQueue_().
 * Reads Engine fresh and refuses to run if the passed mode disagrees with it —
 * Engine!MODE governs every code path, no exceptions (§9.7).
 */
function sendBatch_(rows, stage, mode) {
  var cfg = readEngine_();
  if (engineMode_(cfg) !== mode) {
    throw new Error('Engine!MODE changed mid-run. Nothing was sent. Start again.');
  }
  var problems = engineProblems_(cfg, mode);
  if (problems.length) throw new Error('Cannot send:\n\n  • ' + problems.join('\n  • '));

  var template = activeTemplate_(stage);
  var signature = String(cfg.SIGNATURE_BLOCK || '');
  var senderName = trim_(cfg.SENDER_NAME);
  var replyTo = trim_(cfg.REPLY_TO);
  var testEmail = trim_(cfg.TEST_EMAIL);

  var qsh = sheet_(SHEETS.QUEUE);
  var qmap = headerMap_(qsh);

  // Phase 2 runs a daily trigger alongside manual batches. Without this lock,
  // a trigger firing mid-batch reads the same blank-Status rows and sends twice.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Another outreach run is already in progress. Nothing was sent.');
  }

  var out = { sent: 0, failed: 0, unlinked: 0, notReached: 0, writebackFailures: 0, notes: [], startedAt: new Date() };
  var started = Date.now();

  try {
    for (var i = 0; i < rows.length; i++) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        out.notReached = rows.length - i;
        out.notes.push('Stopped early at the execution time limit; ' + out.notReached + ' row(s) not reached. Re-run to continue — already-sent rows are marked and will not resend.');
        break;
      }

      var item = rows[i];
      try {
        var r = render_(template, item.fields, signature);
        var recipient = (mode === MODE.TEST) ? testEmail : item.email;
        var subject = (mode === MODE.TEST) ? testSubject_(r.subject, item.email) : r.subject;

        // TEST ONLY. operatorCcFor_() returns '' for MODE.LIVE, so on a live
        // send `cc` is not merely blank — the key is never set on the raw
        // message at all, and Gmail receives exactly what it received before
        // this change existed. Asserted in both directions by the harness.
        var ccAddress = operatorCcFor_(mode);

        // DEVIATION (Dev Log 2026-10-01): GmailApp.createDraft(...).send() is
        // gone. GmailApp cannot carry a code point at or above U+10000 — most
        // non-BMP emoji (📅 🤝 👉 🚩 📱) — in either subject or body; they are
        // lost in the sender's OWN Sent folder, not just the recipient's inbox.
        // Confirmed with a standalone GmailApp.createDraft(...).send() call
        // outside this codebase, so no Vale code was ever the cause. The Gmail
        // advanced service (Gmail.Users.Messages.send) sending a hand-built raw
        // RFC 2822 message is the only path that keeps those characters.
        // sendRawMime_() does the encoding; it returns { messageId, threadId }
        // straight from the API response, so Thread ID capture (the reason
        // this codebase moved off GmailApp.sendEmail() in the first place — no
        // search-by-subject needed) is unchanged in shape, just sourced from a
        // different call.
        var sent = sendRawMime_({
          to: recipient,
          subject: subject,
          text: r.text,
          html: r.html,
          senderName: senderName,
          replyTo: replyTo,
          cc: ccAddress
        });
        var messageId = sent.messageId;
        var threadId = sent.threadId;
        var now = new Date();
        var status = (mode === MODE.TEST) ? STATUS.TEST_SENT : STATUS.SENT;

        var queueFields = {
          'Status': status,
          'Stage': stage,
          'Sent At': now,
          'Thread ID': threadId,
          'Message ID': messageId,
          'Notes': (mode === MODE.TEST)
            ? 'Test send — delivered to ' + testEmail + (ccAddress ? ', cc ' + ccAddress : '')
            : ''
        };

        if (item.unlinked) {
          out.unlinked++;
          queueFields['Notes'] = (queueFields['Notes'] ? queueFields['Notes'] + '. ' : '') +
            'Unlinked (no Prospect ID) — nothing written back to Prospects.';
        }

        writeQueueFields_(qsh, qmap, item.rowNum, queueFields);

        if (!item.unlinked) {
          var wb = writebackSend_(item.id, stage, mode, status, threadId, messageId, now);
          if (!wb.ok) {
            out.writebackFailures++;
            writeQueueFields_(qsh, qmap, item.rowNum, {
              'Notes': (queueFields['Notes'] ? queueFields['Notes'] + '. ' : '') + 'writeback failed — ' + wb.reason
            });
          }
        }

        // Immediately, per row: a timeout must never lose the record of mail
        // already sent (§8.5).
        SpreadsheetApp.flush();
        out.sent++;

      } catch (err) {
        out.failed++;
        var reason = String(err && err.message ? err.message : err);
        writeQueueFields_(qsh, qmap, item.rowNum, {
          'Status': STATUS.FAILED,
          'Stage': stage,
          'Sent At': new Date(),
          'Notes': reason
        });

        // A failure in TEST mode is a failure of the test, not of the outreach.
        // Writing FAILED to Prospects would block the real send that follows —
        // the same reasoning that keeps TEST-SENT non-blocking (§2).
        if (!item.unlinked && mode === MODE.LIVE) {
          writebackFailure_(item.id, stage);
        }
        SpreadsheetApp.flush();
      }
    }
  } finally {
    lock.releaseLock();
  }

  return out;
}

/**
 * ---------------------------------------------------------------------------
 * Raw MIME send path (Dev Log 2026-10-01).
 *
 * The only thing that changed about how mail leaves this project: sendBatch_()
 * now calls sendRawMime_() where it used to call
 * GmailApp.createDraft(...).send(). Nothing else sends mail (§9.6, unchanged —
 * this is still the sole call site).
 *
 * Root cause this replaces: GmailApp cannot carry a code point at or above
 * U+10000 (most non-BMP emoji) in subject OR body, in the sender's own Sent
 * folder as well as the recipient's inbox. That is a GmailApp limitation, not
 * an escaping bug here — confirmed with a standalone GmailApp script outside
 * this codebase. The fix is to stop handing GmailApp a JS string at all and
 * instead hand the Gmail advanced service a fully-formed RFC 2822 message,
 * base64url-encoded by this code.
 *
 * Phase 2 extension point (NOT built here): a threaded follow-up needs an
 * optional msg.threadId forwarded onto the Gmail API request body as
 * `threadId`, plus In-Reply-To / References headers carrying the prior
 * Message-ID. All three slot into sendRawMime_'s existing shape — one more
 * param, two more headers.push() lines, one more key on the request resource
 * — without changing this function's meaning or sendBatch_()'s call site
 * beyond the new optional fields it would pass.
 * ---------------------------------------------------------------------------
 */

/**
 * msg: { to, subject, text, html, senderName, replyTo, cc }. to/text/html are
 * required; the rest are optional (falsy = header omitted, matching the old
 * opts-object behaviour this replaces).
 *
 * Builds a multipart/alternative message (plain text + UTF-8 HTML, the HTML
 * part carrying the already-assembled body + signature from render_()),
 * RFC 2047-encodes the subject (and the From display name, for the same
 * reason — any non-ASCII in a raw header is as broken as the astral-emoji
 * bug this exists to fix, so both get the same treatment even though only
 * the subject was named in spec), base64-encodes each body part with
 * charset=UTF-8, and sends it via the Gmail advanced service. Returns
 * { messageId, threadId } from the API response.
 */
function sendRawMime_(msg) {
  var headers = [];
  headers.push('MIME-Version: 1.0');
  headers.push('From: ' + fromHeader_(msg.senderName));
  headers.push('To: ' + msg.to);
  if (msg.cc) headers.push('Cc: ' + msg.cc);
  if (msg.replyTo) headers.push('Reply-To: ' + msg.replyTo);
  headers.push('Subject: ' + encodeHeaderText_(msg.subject));

  var boundary = mimeBoundary_();
  headers.push('Content-Type: multipart/alternative; boundary="' + boundary + '"');

  var body =
    '--' + boundary + '\r\n' + mimePart_('text/plain; charset="UTF-8"', msg.text) + '\r\n' +
    '--' + boundary + '\r\n' + mimePart_('text/html; charset="UTF-8"', msg.html) + '\r\n' +
    '--' + boundary + '--';

  var raw = headers.join('\r\n') + '\r\n\r\n' + body;

  // Resource first, userId ('me') second — the Advanced Service wrapper's
  // parameter order for a POST method, which is NOT the same order as the
  // underlying REST path (userId, then body). Calling it the other way round
  // sends the raw message as the userId argument and throws.
  var resp = Gmail.Users.Messages.send({ raw: base64UrlEncode_(raw) }, 'me');
  return { messageId: resp.id, threadId: resp.threadId };
}

/**
 * The account actually running the script. Deliberately NOT operatorEmail_()
 * (09_Writeback.gs) — that one is forgiving by design, falling back to the
 * string '(unknown)' for a best-effort Run Log line. A From header can't take
 * that fallback: '(unknown)' is not an address, and Gmail.Users.Messages.send
 * requires a From header, when present, to match the authenticated account or
 * a verified send-as alias. So this throws instead of guessing.
 */
function senderEmail_() {
  var email = '';
  try {
    email = (Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail());
  } catch (e) {
    email = '';
  }
  email = trim_(email);
  if (!email) throw new Error('Could not determine the sending account\'s email address.');
  return email;
}

function fromHeader_(senderName) {
  var email = senderEmail_();
  var name = trim_(senderName);
  if (!name) return email;
  var display = /[^\x00-\x7F]/.test(name)
    ? encodeRfc2047Words_(name).join('\r\n ')
    : '"' + name.replace(/(["\\])/g, '\\$1') + '"';
  return display + ' <' + email + '>';
}

/** Subject (or any other header text) -> RFC 2047 encoded-word(s) if needed. */
function encodeHeaderText_(s) {
  var text = String(s === null || s === undefined ? '' : s);
  if (!/[^\x00-\x7F]/.test(text)) return text; // pure ASCII — no RFC 2047 needed
  return encodeRfc2047Words_(text).join('\r\n ');
}

/**
 * Splits text into RFC 2047 "=?UTF-8?B?...?=" encoded words, each carrying at
 * most MAX_CHUNK_BYTES of UTF-8 — comfortably under the 76-column line limit
 * once the "=?UTF-8?B?" / "?=" wrapper is added — folded with "\r\n " between
 * words per RFC 2822 §2.2.3.
 *
 * Split at CODE POINTS (Array.from), never UTF-16 code units: a surrogate
 * pair is one code point, and splitting between its two halves — or between
 * the bytes of any multi-byte UTF-8 character — would hand a decoder one
 * encoded-word it cannot reassemble into the original character. This is the
 * exact failure mode the astral-emoji fix exists to avoid, just one encoding
 * layer further down, so it gets the same care here.
 */
function encodeRfc2047Words_(text) {
  var MAX_CHUNK_BYTES = 45;
  var codePoints = Array.from(text);
  var words = [];
  var chunk = '';
  var chunkBytes = 0;
  codePoints.forEach(function (cp) {
    var n = utf8ByteLength_(cp);
    if (chunk && chunkBytes + n > MAX_CHUNK_BYTES) {
      words.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += cp;
    chunkBytes += n;
  });
  if (chunk) words.push(chunk);
  return words.map(function (w) {
    return '=?UTF-8?B?' + Utilities.base64Encode(w, Utilities.Charset.UTF_8) + '?=';
  });
}

function utf8ByteLength_(codePointStr) {
  var code = codePointStr.codePointAt(0);
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/** One multipart/alternative part: headers + a blank line + base64 content. */
function mimePart_(contentType, text) {
  return 'Content-Type: ' + contentType + '\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    base64Wrap76_(Utilities.base64Encode(String(text === null || text === undefined ? '' : text),
      Utilities.Charset.UTF_8));
}

/** RFC 2045 requires base64 body content wrapped at 76 characters. */
function base64Wrap76_(b64) {
  var lines = [];
  for (var i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

/** The whole raw message -> base64url, as Gmail.Users.Messages.send requires. */
function base64UrlEncode_(str) {
  return Utilities.base64EncodeWebSafe(str, Utilities.Charset.UTF_8);
}

/** Pure JS, no Utilities.getUuid() dependency — one less mock surface. */
function mimeBoundary_() {
  return 'valeMime_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Writes named fields to one Send Queue row. */
function writeQueueFields_(qsh, qmap, rowNum, fields) {
  Object.keys(fields).forEach(function (name) {
    qsh.getRange(rowNum, col_(qmap, name, SHEETS.QUEUE)).setValue(fields[name]);
  });
}

function summaryText_(o, heldReason) {
  var lines = [];
  lines.push('Mode: ' + o.mode + '   Stage: ' + o.stage);
  lines.push('Evaluated: ' + o.evaluated);
  lines.push('Sent: ' + o.sent + (o.mode === MODE.TEST ? ' (to your test address, marked TEST-SENT)' : ''));
  lines.push('Skipped: ' + o.skipped);
  lines.push('Failed: ' + o.failed);
  if (o.unlinked) lines.push('Unlinked (sent, nothing written back): ' + o.unlinked);
  if (o.writebackFailures) lines.push('Writeback failures: ' + o.writebackFailures + ' — see Notes on the queue rows');
  if (o.heldBack) lines.push('Held back (' + heldReason + ' / time limit): ' + o.heldBack);
  lines.push('Gmail recipients remaining today: ' + o.quotaRemaining);
  if (o.notes.length) {
    lines.push('');
    o.notes.forEach(function (n) { lines.push(n); });
  }
  return lines.join('\n');
}