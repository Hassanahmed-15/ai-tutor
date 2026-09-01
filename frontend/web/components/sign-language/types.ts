export type SignPoint = readonly [x: number, y: number, z: number];

export type SignFrame = readonly SignPoint[];

export type AlphabetPoseData = Readonly<Record<string, readonly SignFrame[]>>;

export type FingerSpellingUnit = {
  word: string;
  letter: string;
  wordIndex: number;
  letterIndex: number;
};

