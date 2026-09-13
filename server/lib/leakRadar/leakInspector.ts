export interface LeakMediaInspection {
  watermark: { detected: boolean; label?: string };
  hardcodedSubs: { detected: boolean; label?: string };
  audioProfile: { isOriginal: boolean; type: string; language?: string };
  qualityGrade: 'A' | 'B' | 'C' | 'D';
  cleanVideo: boolean;
  flags: string[];
}

export const inspectLeak = (
  title: string,
  description?: string
): LeakMediaInspection => {
  const combined = (title + ' ' + (description || '')).toUpperCase();
  const flags: string[] = [];

  // 1. Watermark & Bettor Detection (Anti-1XBET)
  const watermarkRegex = /\b(1XBET|1X-BET|MELBET|BETWINNER|LINEBET|POKERSTARS|PARIMATCH|WST|BK)\b/i;
  const watermarkMatch = combined.match(watermarkRegex);
  const hasWatermark = !!watermarkMatch;
  if (hasWatermark && watermarkMatch) {
    flags.push('Marca de Agua: ' + watermarkMatch[0]);
  }

  // 2. Hardcoded Subtitles Detection
  const subRegex = /\b(HC|HCSUB|SUBBED|KORSUB|CHISUB|ZH-SUB|ENGSUB|HARDCODED|NL-SUBS)\b/i;
  const subMatch = combined.match(subRegex);
  const hasHardcodedSubs = !!subMatch;
  if (hasHardcodedSubs && subMatch) {
    flags.push('Subtítulos Incrustados (' + subMatch[0] + ')');
  }

  // 3. Audio Profile Analysis
  const micOrLineRegex = /\b(LINE|MIC|MD|LD|LINE-DUB|TS-AUDIO|CAM-AUDIO)\b/i;
  const hasDubOrMic = micOrLineRegex.test(combined);

  const cleanAudioRegex = /\b(ENGLISH|ENG|ORIGINAL|ATMOS|DDP5\.1|DD5\.1|AAC|TRUEHD|DTS-HD|FLAC|AC3)\b/i;
  const hasCleanAudioIndicator = cleanAudioRegex.test(combined);

  let audioType = 'Original / Limpio';
  let isOriginalAudio = true;

  if (hasDubOrMic) {
    isOriginalAudio = false;
    audioType = 'Micrófono / Line Dub (Sonido de Sala)';
    flags.push('Audio Grabado / Mic');
  } else if (/\b(RUSSIAN|GERMAN|FRENCH|ITALIAN|HINDI)\b/i.test(combined) && !/\b(ENG|ENGLISH)\b/i.test(combined)) {
    isOriginalAudio = false;
    audioType = 'Doblaje Extranjero';
    flags.push('Audio No Original');
  } else if (hasCleanAudioIndicator) {
    audioType = 'Digital Estéreo / 5.1';
  }

  // 4. Quality Grade Assessment
  let grade: LeakMediaInspection['qualityGrade'] = 'A';
  if (/\b(CAM|CAMRIP|TS|TELESYNC|HDTS)\b/i.test(combined)) {
    grade = 'D';
    flags.push('Calidad Grabación de Cine');
  } else if (hasWatermark || hasDubOrMic) {
    grade = 'C';
  } else if (hasHardcodedSubs) {
    grade = 'B';
  } else {
    grade = 'A';
  }

  return {
    watermark: {
      detected: hasWatermark,
      label: hasWatermark && watermarkMatch ? watermarkMatch[0] : undefined,
    },
    hardcodedSubs: {
      detected: hasHardcodedSubs,
      label: hasHardcodedSubs && subMatch ? subMatch[0] : undefined,
    },
    audioProfile: {
      isOriginal: isOriginalAudio,
      type: audioType,
    },
    qualityGrade: grade,
    cleanVideo: !hasWatermark && grade !== 'D',
    flags,
  };
};
