// Metro needs static require() calls to bundle the audio assets.

export type Track = { title: string; source: number };

// Three queue tracks of about two minutes each (about 6 minutes 18 seconds in total).
export const QUEUE_TRACKS: readonly Track[] = [
  { title: 'Тест 1', source: require('../../assets/spike/story-1.m4a') as number },
  { title: 'Тест 2', source: require('../../assets/spike/story-2.m4a') as number },
  { title: 'Тест 3', source: require('../../assets/spike/story-3.m4a') as number },
];

// Played after a detected answer, and used for the fade-out run on silence.
export const EXTRA_TRACK: Track = {
  title: 'Тест: ещё одна история',
  source: require('../../assets/spike/story-extra.m4a') as number,
};

// Pre-rendered «Вы спите?» prompt (a system voice here, not the production TTS).
export const PROMPT_TRACK: Track = {
  title: 'Вы спите?',
  source: require('../../assets/spike/prompt.m4a') as number,
};

// Two seconds of digital silence, played in a loop during the listening window. It is a clock: native
// player status updates keep reaching JS in the background, while JS timers do not (see the
// scheduler in audioController.ts).
export const METRONOME_TRACK: Track = {
  title: 'silence',
  source: require('../../assets/spike/silence.m4a') as number,
};
