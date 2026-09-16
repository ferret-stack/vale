/**
 * 06_Render.gs — §4, §8, Addendum v1 §1.
 *
 * A missing placeholder value is a validation failure, never a blank
 * substitution. "Hi ," must be impossible by construction, so the renderer
 * throws rather than returning a partly-filled string.
 *
 * ADDENDUM v1: render_() now returns { subject, text, html }.
 *   • Template bodies stay plain text. The BDM never writes a tag: the body is
 *     escaped, then blank-line-separated blocks become <p> and single newlines
 *     become <br>. Escaping happens AFTER placeholder substitution, so a
 *     company called "Rowe & Sons" or a job title containing "<" survives.
 *   • SIGNATURE_BLOCK is operator-owned and passes through as raw HTML.
 *   • text is the plain-text alternative part, not a fallback nobody reads —
 *     it is what keeps the message multipart/alternative rather than HTML-only.
 */

/** Placeholder tokens actually used by a template, e.g. ['FirstName','Company']. */
function usedPlaceholders_(template) {
  var text = template.subject + '\n' + template.body;
  var found = {};
  var re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  var m;
  while ((m = re.exec(text)) !== null) found[m[1]] = true;
  return Object.keys(found);
}

/**
 * Placeholders present in the template but not in PLACEHOLDERS — a typo like
 * {{Firstname}} would otherwise ship as literal text in a real email.
 */
function unknownPlaceholders_(template) {
  return usedPlaceholders_(template).filter(function (p) {
    return !Object.prototype.hasOwnProperty.call(PLACEHOLDERS, p);
  });
}

/** Placeholders the template needs but this row cannot fill. */
function missingPlaceholderValues_(template, fields) {
  return usedPlaceholders_(template).filter(function (p) {
    if (!Object.prototype.hasOwnProperty.call(PLACEHOLDERS, p)) return false; // reported separately
    return isBlank_(fields[PLACEHOLDERS[p]]);
  });
}

// ---------------------------------------------------------------------------
// Plain text <-> HTML
// ---------------------------------------------------------------------------

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Does this string contain a real HTML tag? Used only to decide how to treat
 * SIGNATURE_BLOCK — see htmlSignature_().
 */
function looksLikeHtml_(s) {
  return /<\s*\/?\s*[a-zA-Z][a-zA-Z0-9]*(\s[^<>]*)?\/?\s*>/.test(String(s));
}

/** BDM-authored plain text -> escaped HTML paragraphs. No tags required, ever. */
function plainTextToHtml_(text) {
  var esc = escapeHtml_(String(text).replace(/\r\n?/g, '\n')).replace(/\s+$/, '');
  if (!esc) return '';
  return esc.split(/\n{2,}/).map(function (block) {
    return '<p style="margin:0 0 1em 0;">' + block.replace(/\n/g, '<br />') + '</p>';
  }).join('\n');
}

/**
 * HTML -> a readable plain-text alternative. Deliberately crude: this part is
 * never the primary rendering, and a signature that needs a hand-authored text
 * version is a signature that belongs in two Engine keys, not in a parser.
 */
function htmlToPlainText_(html) {
  var s = String(html).replace(/\r\n?/g, '\n');
  s = s.replace(/<\s*(style|script|head)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\s*\/\s*a\s*>/gi,
    function (_, href, inner) {
      var t = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (!href || /^mailto:/i.test(href)) return t || href.replace(/^mailto:/i, '');
      return (t && t !== href) ? t + ' (' + href + ')' : href;
    });
  s = s.replace(/<\s*li[^>]*>/gi, '\n\u2022 ');
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*\/\s*(p|div|tr|li|h[1-6]|table|ul|ol)\s*>/gi, '\n');
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/&nbsp;/gi, ' ')
       .replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>')
       .replace(/&quot;/gi, '"')
       .replace(/&#39;/g, "'")
       .replace(/&amp;/gi, '&');
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * SIGNATURE_BLOCK -> { html, text }.
 *
 * DEVIATION from Addendum §1a ("raw, no auto-conversion"), deliberate: the
 * cell already holds plain text on every install built before this change.
 * Treating that as raw HTML would silently collapse a multi-line signature —
 * including its opt-out line — onto one run-on line in every outgoing email,
 * with nothing to indicate anything had changed. So a signature containing no
 * tag at all is converted like body text; anything carrying a tag passes
 * through untouched, which is the case the addendum is actually about. The
 * check is on content, and the result is visible in the send preview before
 * any mail moves.
 */
function htmlSignature_(signatureBlock) {
  var raw = String(signatureBlock || '');
  if (!trim_(raw)) return { html: '', text: '' };
  if (looksLikeHtml_(raw)) return { html: raw, text: htmlToPlainText_(raw) };
  return { html: plainTextToHtml_(raw), text: raw.replace(/\s+$/, '') };
}

/** Body HTML + signature HTML -> one document. */
function assembleHtmlMessage_(bodyHtml, signatureHtml) {
  return '<!DOCTYPE html>\n<html><body style="margin:0;font-family:Arial,Helvetica,sans-serif;' +
    'font-size:14px;line-height:1.5;color:#202124;">\n' +
    bodyHtml +
    (signatureHtml ? '\n<div>' + signatureHtml + '</div>' : '') +
    '\n</body></html>';
}

// ---------------------------------------------------------------------------

/**
 * fields: {'First Name': …, 'Company': …, 'Job Title': …, 'Town/Area': …}
 * Returns { subject, text, html }. Throws if any used placeholder is unknown
 * or empty. Subject is always plain text — it is never an HTML context.
 */
function render_(template, fields, signatureBlock) {
  var unknown = unknownPlaceholders_(template);
  if (unknown.length) {
    throw new Error('Template "' + template.name + '" uses unknown placeholder(s): {{' +
      unknown.join('}}, {{') + '}}. Valid placeholders are {{' + Object.keys(PLACEHOLDERS).join('}}, {{') + '}}.');
  }
  var missing = missingPlaceholderValues_(template, fields);
  if (missing.length) {
    throw new Error('Missing value(s) for {{' + missing.join('}}, {{') + '}} on this row.');
  }

  function fill(text) {
    return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, function (_, key) {
      return String(fields[PLACEHOLDERS[key]]).trim();
    });
  }

  var bodyText = fill(template.body).replace(/\s*$/, '');
  var sig = htmlSignature_(signatureBlock);

  return {
    subject: fill(template.subject).trim(),
    text: bodyText + (sig.text ? '\n\n' + sig.text : ''),
    html: assembleHtmlMessage_(plainTextToHtml_(bodyText), sig.html)
  };
}