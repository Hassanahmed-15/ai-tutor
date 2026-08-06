import {
  Accessibility,
  BookOpen,
  Building2,
  Captions,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Contrast,
  DoorOpen,
  Headphones,
  Map,
  Maximize2,
  Menu,
  Mic2,
  Navigation,
  Pause,
  PersonStanding,
  Sparkles,
  Users,
  Volume1,
  X,
} from "lucide-react";
import { CAMPUS_PEOPLE, CAMPUS_ROOMS } from "./campus";
import type { AccessibilityProfile, CampusRoom } from "./types";

type HudProps = {
  selectedRoom: CampusRoom;
  profile: AccessibilityProfile;
  navOpen: boolean;
  accessibilityOpen: boolean;
  onNavigate: (roomId: string) => void;
  onToggleNav: () => void;
  onToggleAccessibility: () => void;
  onChangeProfile: (profile: AccessibilityProfile) => void;
  onOpenBoard: () => void;
};

const ROOM_ICONS: Record<string, typeof Building2> = {
  atrium: Building2,
  general: BookOpen,
  focus: Navigation,
  sensory: Headphones,
  vision: Contrast,
  communication: Captions,
  commons: Users,
  library: BookOpen,
  wellness: Sparkles,
};

export function CampusHud(props: HudProps) {
  const { selectedRoom, profile, navOpen, accessibilityOpen } = props;
  const classroom = selectedRoom.zone === "classroom";

  return (
    <>
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">A</span>
          <div>
            <strong>ARIA Virtual Campus</strong>
            <span>East Academic Building</span>
          </div>
        </div>
        <div className="session-status" aria-label="Campus session status">
          <span className="status-pulse" aria-hidden="true" />
          <span>Campus open</span>
          <span className="status-divider" />
          <span>18 online</span>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={props.onToggleAccessibility} aria-label="Accessibility preferences" aria-expanded={accessibilityOpen} title="Accessibility preferences">
            <Accessibility size={21} />
          </button>
          <button className="profile-button" aria-label="Open profile" title="Profile">
            <CircleUserRound size={23} />
            <span>You</span>
          </button>
        </div>
      </header>

      <button className={`nav-toggle icon-button${navOpen ? " is-open" : ""}`} onClick={props.onToggleNav} aria-label={navOpen ? "Close campus navigator" : "Open campus navigator"} aria-expanded={navOpen}>
        {navOpen ? <ChevronLeft size={21} /> : <Menu size={21} />}
      </button>

      <nav id="campus-navigation" className={`campus-nav${navOpen ? " is-open" : ""}`} aria-label="Campus destinations">
        <div className="panel-heading">
          <div>
            <span>Campus navigator</span>
            <h2>Where would you like to go?</h2>
          </div>
          <Map size={22} aria-hidden="true" />
        </div>
        <div className="destination-list">
          {CAMPUS_ROOMS.map((room) => {
            const Icon = ROOM_ICONS[room.id] ?? DoorOpen;
            const active = room.id === selectedRoom.id;
            return (
              <button
                key={room.id}
                className={`destination${active ? " is-active" : ""}`}
                onClick={() => props.onNavigate(room.id)}
                aria-current={active ? "location" : undefined}
              >
                <span className="destination-icon" style={{ "--room-color": room.accent } as React.CSSProperties}>
                  <Icon size={18} />
                </span>
                <span className="destination-copy">
                  <strong>{room.shortName}</strong>
                  <small>{room.nextSession}</small>
                </span>
                <span className="occupancy" aria-label={`${room.occupied} occupants`}>
                  <Users size={13} /> {room.occupied}
                </span>
              </button>
            );
          })}
        </div>
        <div className="safe-place">
          <button onClick={() => props.onNavigate("wellness")}>
            <Sparkles size={17} /> Go to safe place <kbd>Q</kbd>
          </button>
        </div>
      </nav>

      <section className="room-context" aria-live="polite">
        <div className="room-label" style={{ "--room-color": selectedRoom.accent } as React.CSSProperties}>
          <span>{selectedRoom.subject}</span>
          <h1>{selectedRoom.name}</h1>
        </div>
        <p>{selectedRoom.description}</p>
        <div className="room-meta">
          <span><Users size={15} /> {selectedRoom.occupied} here</span>
          <span><PersonStanding size={15} /> Capacity {selectedRoom.capacity}</span>
        </div>
        <p className="accommodation">{selectedRoom.accommodation}</p>
        {classroom && (
          <button className="primary-action" onClick={props.onOpenBoard}>
            <Maximize2 size={18} /> Enter class & open smartboard
          </button>
        )}
      </section>

      <div className="control-hint" aria-hidden="true">
        <span><kbd>WASD</kbd> move</span>
        <span><kbd>drag</kbd> look</span>
        <span><kbd>Shift</kbd> run</span>
        <span><kbd>E</kbd> interact</span>
        <span><kbd>R</kbd> reset</span>
      </div>

      <aside className="presence-strip" aria-label="People nearby">
        <span className="presence-title">Nearby</span>
        {CAMPUS_PEOPLE.slice(0, 4).map((person) => (
          <button key={person.id} className="person-chip" aria-label={`${person.name}, ${person.role}, ${person.status}`} title={`${person.name} · ${person.role}`}>
            <span className="person-avatar" style={{ background: person.palette[0] }}>{person.name.charAt(0)}</span>
            <span className={`person-status is-${person.status}`} />
          </button>
        ))}
        <button className="person-more" aria-label="See all 18 people">+14</button>
      </aside>

      {accessibilityOpen && (
        <AccessibilityPanel profile={profile} onChange={props.onChangeProfile} onClose={props.onToggleAccessibility} />
      )}
    </>
  );
}

function AccessibilityPanel({ profile, onChange, onClose }: { profile: AccessibilityProfile; onChange: (profile: AccessibilityProfile) => void; onClose: () => void }) {
  const toggles: Array<{ key: keyof AccessibilityProfile; label: string; detail: string; icon: typeof Pause }> = [
    { key: "reducedMotion", label: "Reduced motion", detail: "Direct camera travel and restrained avatar movement", icon: Pause },
    { key: "highContrast", label: "High contrast", detail: "Stronger controls, labels, and focus boundaries", icon: Contrast },
    { key: "quietWorld", label: "Quiet world", detail: "Remove nonessential motion and environmental activity", icon: Volume1 },
    { key: "largeLabels", label: "Larger labels", detail: "Increase semantic navigation and room text", icon: Maximize2 },
    { key: "monoAudio", label: "Mono audio", detail: "Keep important sound information in both channels", icon: Headphones },
  ];

  return (
    <aside className="accessibility-panel" aria-labelledby="accessibility-title">
      <div className="panel-heading">
        <div>
          <span>Personalize your environment</span>
          <h2 id="accessibility-title">Accessibility</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close accessibility preferences"><X size={20} /></button>
      </div>
      <p>Preferences apply across every campus space.</p>
      <div className="preference-list">
        {toggles.map(({ key, label, detail, icon: Icon }) => (
          <label className="preference" key={key}>
            <span className="preference-icon"><Icon size={18} /></span>
            <span className="preference-copy"><strong>{label}</strong><small>{detail}</small></span>
            <input
              type="checkbox"
              checked={profile[key]}
              onChange={(event) => onChange({ ...profile, [key]: event.target.checked })}
            />
            <span className="switch" aria-hidden="true" />
          </label>
        ))}
      </div>
      <div className="accessibility-note">
        <Mic2 size={17} /> Voice and typed interaction remain available together on the classroom smartboard.
      </div>
    </aside>
  );
}
