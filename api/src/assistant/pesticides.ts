/**
 * Pesticides that older extension booklets recommend but India has since banned or restricted: Endosulfan by the
 * Supreme Court; the 18 products of the Banning Order S.O. 3951(E) of 2018, including Phorate and Tridemorph; Dicofol,
 * Dinocap, Methomyl and Monocrotophos under the Insecticides (Prohibition) Order, 2023, which also restricted Carbofuran;
 * and the older bans. A passage naming one is withheld rather than quoted to a farmer, and a model may not name one.
 * Review this list against the current CIB&RC list; it errs on the side of withholding.
 */
const RESTRICTED: [name: string, pattern: RegExp][] = [
  ["Phorate", /\bphorate\b|\bth[il1]m[e3]t\b|ಫ[ೋೊ]ರೇಟ್|ಥ[ಿೈ]ಮೆಟ್|ತಿಮೆಟ್/i],
  ["Endosulfan", /\bendosul(?:f|ph)an\b|\bthiodan\b|ಎಂಡ[ೋೊ]ಸಲ್ಫಾನ್/i],
  ["Carbofuran", /\bcarbofuran\b|\bfuradan\b|ಕಾರ್ಬ[ೋೊ]ಫ್ಯ[ೂು]ರಾನ್|ಫ್ಯ[ೂು]ರಡಾನ್/i],
  ["Monocrotophos", /\bmonocrotophos\b|ಮ[ೋೊ]ನ[ೋೊ]ಕ್ರ[ೋೊ]ಟ[ೋೊ]ಫಾಸ್/i],
  ["Methyl parathion", /\b(?:methyl )?parathion\b|\bmetacid\b/i],
  ["Quinalphos", /\bquinalphos\b|\bekalux\b/i],
  ["BHC", /\bB\.\s?H\.\s?C\b|\bBHC\b|\bhexachlorocyclohexane\b|ಬಿ\.?ಹೆಚ್\.?ಸಿ/i],
  ["Lindane", /\blindane\b|ಲಿಂಡೇನ್/i],
  ["Aldrin", /\baldrin\b|\bdieldrin\b|ಆ?ಅ?ಲ್ಡ್ರಿನ್/i],
  ["Chlordane", /\bchlordane\b|\bheptachlor\b/i],
  ["DDT", /\bD\.\s?D\.\s?T\b|\bDDT\b/],
  ["Fenitrothion", /\bfenitrothion\b/i],
  ["Phosphamidon", /\bphosphamidon\b|\bdimecron\b/i],
  ["Tridemorph", /\btridemorph\b|\bcal[iy]xin\b|ಕ್ಯಾಲಿಕ್ಸಿನ್|ಕ್ಯಾಲಿಕ್ಸೀನ್|ಟ್ರೈಡೆಮಾರ್ಫ್/i],
  ["Carbaryl", /\bcarbaryl\b|\bsevin\b|ಕಾರ್ಬರಿಲ್|ಸೆವಿನ್/i],
  ["Dichlorvos", /\bdichlorvos\b|\bnuvan\b|\bD\.?D\.?V\.?P\b|ಡೈಕ್ಲೋರ್‌?ವಾಸ್|ನುವಾನ್/i],
  ["Dicofol", /\bdicofol\b|\bkelthane\b|ಡೈಕೋಫಾಲ್|ಕೆಲ್ಥೇನ್/i],
  ["Dinocap", /\bdinocap\b|\bkarathane\b/i],
  ["Methomyl", /\bmethomyl\b/i],
  ["Other products banned in 2018", /\b(?:benomyl|benlate|diazinon|fenarimol|fenthion|lebaycid|linuron|thiometon|ekatin|trifluralin|alachlor|triazophos|hostathion|trichlorfon|dipterex|sodium cyanide)\b/i],
];

export function restrictedPesticides(text: string): string[] {
  return RESTRICTED.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
