import { memo, useCallback } from 'react';
import { motion } from 'motion/react';
import type { PersonaType } from '../../types';

interface PersonaSelectorProps {
  value: PersonaType;
  onChange: (persona: PersonaType) => void;
}

const PERSONAS = [
  {
    type: 'professor' as PersonaType,
    name: 'Professor',
    description: 'Authoritative \u00b7 Cites sources \u00b7 Precise',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="2" width="14" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7 6h6M7 9h6M7 12h4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.6" />
      </svg>
    ),
  },
  {
    type: 'storyteller' as PersonaType,
    name: 'Storyteller',
    description: 'Cinematic \u00b7 Intimate \u00b7 Narrative arc',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
        <polygon points="8,7 8,13 14,10" stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    type: 'explorer' as PersonaType,
    name: 'Field Researcher',
    description: 'Conversational \u00b7 First-person \u00b7 Curious',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.2" />
        <line x1="12.5" y1="12.5" x2="17" y2="17" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
] as const;

const spring = { type: 'spring' as const, stiffness: 400, damping: 17 };

const SERIF_STYLE = { fontFamily: 'var(--font-serif)' } as const;

export const PersonaSelector = memo(function PersonaSelector({ value, onChange }: PersonaSelectorProps) {
  const handlePersonaClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const type = e.currentTarget.dataset.persona as PersonaType;
    onChange(type);
  }, [onChange]);

  return (
    <div className="flex gap-3 justify-center" role="radiogroup" aria-label="Choose historian persona">
      {PERSONAS.map((persona) => {
        const selected = value === persona.type;
        return (
          <motion.button
            key={persona.type}
            type="button"
            role="radio"
            aria-checked={selected}
            data-persona={persona.type}
            onClick={handlePersonaClick}
            className={`relative w-[120px] rounded-lg border p-3 cursor-pointer text-center transition-colors ${
              selected
                ? 'border-[var(--gold)] bg-[var(--bg3)]'
                : 'border-[var(--bg4)] bg-[var(--bg2)] hover:border-[var(--gold)]/40'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            transition={spring}
          >
            {/* Gold left bar for selected state */}
            {selected && (
              <motion.div
                layoutId="persona-indicator"
                className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-[var(--gold)]"
                transition={spring}
              />
            )}

            <div className={`flex justify-center mb-2 ${selected ? 'text-[var(--gold)]' : 'text-[var(--muted)]'}`}>
              {persona.icon}
            </div>

            <p
              className={`text-[14px] leading-tight ${selected ? 'text-[var(--text)]' : 'text-[var(--text)]'}`}
              style={SERIF_STYLE}
            >
              {persona.name}
            </p>

            <p className="text-[10px] text-[var(--muted)] font-sans mt-1 leading-snug">
              {persona.description}
            </p>
          </motion.button>
        );
      })}
    </div>
  );
});
