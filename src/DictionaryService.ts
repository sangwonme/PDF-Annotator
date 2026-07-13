export interface DictionaryEntry {
	word: string;
	formatted: string;
}

const POS_KO: Record<string, string> = {
	noun: "명사",
	verb: "동사",
	adjective: "형용사",
	adverb: "부사",
	pronoun: "대명사",
	preposition: "전치사",
	conjunction: "접속사",
	interjection: "감탄사",
	exclamation: "감탄사",
	abbreviation: "약어",
};

async function translateToKorean(text: string): Promise<string> {
	const r = await fetch(
		`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ko`
	);
	if (!r.ok) return text;
	const data = await r.json() as { responseData?: { translatedText?: string } };
	return data?.responseData?.translatedText ?? text;
}

export class DictionaryService {
	async lookup(text: string): Promise<DictionaryEntry | null> {
		const word = text.trim();
		if (!word) return null;

		const isSingleWord = !/\s/.test(word);
		let koreanTranslation = "";
		let koDefs: string[] = [];

		// Always fetch Korean translation of the word/phrase
		const fetchTranslation = translateToKorean(word)
			.then(t => {
				if (t && t.toLowerCase() !== word.toLowerCase()) {
					koreanTranslation = t;
				}
			})
			.catch(() => {});

		// For single words, also fetch English definitions and translate them
		let fetchDefs = Promise.resolve();
		if (isSingleWord) {
			fetchDefs = fetch(
				`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`
			)
				.then(r => r.ok ? r.json() : null)
				.then(async (data: unknown) => {
					if (!Array.isArray(data) || !data.length) return;

					const collected: { pos: string; text: string }[] = [];
					for (const entry of data) {
						for (const meaning of (entry.meanings ?? []) as { partOfSpeech: string; definitions: { definition: string }[] }[]) {
							const pos = meaning.partOfSpeech as string;
							for (const def of (meaning.definitions ?? []).slice(0, 1)) {
								collected.push({ pos, text: def.definition });
								if (collected.length >= 2) break;
							}
							if (collected.length >= 2) break;
						}
						if (collected.length >= 2) break;
					}

					// Translate each definition to Korean in parallel
					koDefs = await Promise.all(
						collected.map(d =>
							translateToKorean(d.text)
								.then(ko => `[${POS_KO[d.pos] ?? d.pos}] ${ko}`)
								.catch(() => `[${POS_KO[d.pos] ?? d.pos}] ${d.text}`)
						)
					);
				})
				.catch(() => {});
		}

		await Promise.all([fetchTranslation, fetchDefs]);

		if (!koreanTranslation && !koDefs.length) return null;

		let formatted = `📖 ${word}`;
		if (koreanTranslation) {
			formatted += ` · ${koreanTranslation}`;
		}
		if (koDefs.length) {
			formatted += "\n" + koDefs.join("\n");
		}

		return { word, formatted };
	}
}
