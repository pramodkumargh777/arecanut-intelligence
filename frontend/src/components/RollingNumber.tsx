/**
 * A price that rolls into place like an odometer: each digit is a 0–9 column that slides to its value when the number
 * appears, and slides again if the value changes (for example on switching variety). Punctuation and words stay still.
 *
 * The final number is the element's resting state; the roll on first appearance is a CSS animation layered on top. So
 * if the animation never runs (a background tab, print, a screenshot tool, "reduce motion"), the correct price simply
 * shows: nothing depends on script timing. Digits fade in while they roll, so a half-rolled "₹00,000" is never readable.
 * Screen readers get the plain text. Nothing loops.
 */
export function RollingNumber({ text }: { text: string }) {
  // Digits roll one by one; everything between them (₹, commas, words, Kannada script) stays one unbroken run, so
  // letters keep their shaping.
  const parts = text.match(/\d|\D+/g) ?? [];
  const digits = parts.filter((part) => /^\d$/.test(part)).length;
  let seen = 0;
  return <span className="roll">
    <span className="sr-only">{text}</span>
    <span className="roll-face" aria-hidden="true">{parts.map((part, index) => {
      if (!/^\d$/.test(part)) return <span key={index} className="roll-char">{part}</span>;
      const order = seen++;
      // Left digits settle first and the last digit last, a gentle left-to-right cascade within ~0.55s.
      const delay = digits > 1 ? Math.round((order / (digits - 1)) * 120) : 0;
      return <span key={index} className="roll-digit">
        <span className="roll-strip" style={{ transform: `translateY(-${Number(part) * 10}%)`, animationDelay: `${delay}ms`, transitionDelay: `${delay}ms` }}>
          {"0123456789".split("").map((digit) => <span key={digit}>{digit}</span>)}
        </span>
      </span>;
    })}</span>
  </span>;
}

/**
 * A sentence whose figures roll (prices such as ₹43,048, percentages such as +0.8%, counts such as "2 of 5") while
 * the words stay ordinary text, so a long line still wraps on a phone and Kannada keeps its shaping.
 */
export function RollingText({ text }: { text: string }) {
  const pieces = text.split(/(₹?[+\-−]?\d[\d,]*(?:\.\d+)?%?)/);
  return <>{pieces.map((piece, index) => index % 2 ? <RollingNumber key={index} text={piece} /> : piece)}</>;
}
