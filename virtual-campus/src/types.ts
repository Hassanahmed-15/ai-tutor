export type CampusZone =
  | "atrium"
  | "commons"
  | "library"
  | "classroom"
  | "wellness"
  | "dining"
  | "lab"
  | "auditorium"
  | "quiet"
  | "office";

export type AccessibilityProfile = {
  reducedMotion: boolean;
  highContrast: boolean;
  quietWorld: boolean;
  largeLabels: boolean;
  monoAudio: boolean;
};

export type CampusRoom = {
  id: string;
  shortName: string;
  name: string;
  subject: string;
  description: string;
  accommodation: string;
  zone: CampusZone;
  position: [number, number, number];
  camera: [number, number, number];
  target: [number, number, number];
  accent: string;
  capacity: number;
  occupied: number;
  nextSession: string;
  tutorRoute?: string;
};

export type CampusPerson = {
  id: string;
  name: string;
  role: string;
  status: "available" | "teaching" | "focused";
  position: [number, number, number];
  palette: [string, string, string];
  activity: "idle" | "talk" | "study" | "teach";
};
