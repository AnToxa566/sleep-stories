import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme/tokens';

// Generic line icons, drawn for this app on a 24 x 24 grid with a 1.6 px stroke.
const PATHS = {
  // The chevron from the designs (sign-in, sign-up and every reset step use this one).
  back: 'M15 6l-6 6 6 6',
  check: 'M4.5 12.5l5 5 10-11',
  plus: 'M12 5v14M5 12h14',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M7.5 5h3v14h-3zM13.5 5h3v14h-3z',
  bell: 'M12 3.5c-3.3 0-5.5 2.4-5.5 5.6v3.3L5 15.5h14l-1.5-3.1V9.1c0-3.2-2.2-5.6-5.5-5.6zM9.8 18.5a2.3 2.3 0 0 0 4.4 0',
  // Bottom bar (design frame 2a): moon, compass, sliders.
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  compass: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM15.5 8.5l-2 5-5 2 2-5z',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM10 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  // Toasts and the item menu (frames 2a·8 to 2a·11).
  close: 'M6 6l12 12M18 6L6 18',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  chevronRight: 'M9 6l6 6-6 6',
  // «К очереди» on the plate of «Темы» (frame s-topics).
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  // Drag handle of a queue row (frame 2a): two lines.
  reorder: 'M5 9h14M5 15h14',
  // «Создать и начать» and the empty-state actions (frames 2a, 2a·3, 2a·4): a four-point spark.
  sparkle:
    'M12 3.5c.6 4.6 3.9 7.9 8.5 8.5-4.6.6-7.9 3.9-8.5 8.5-.6-4.6-3.9-7.9-8.5-8.5 4.6-.6 7.9-3.9 8.5-8.5z',
  // The player (frame 3a): previous and next story, and the hand of «Нажмите в любом месте» (3c).
  skipPrevious: 'M6 5v14M18 5.5l-9 6.5 9 6.5z',
  skipNext: 'M18 5v14M6 5.5l9 6.5-9 6.5z',
  touch:
    'M10 13V5.5a1.5 1.5 0 0 1 3 0V12M13 11.5a1.5 1.5 0 0 1 3 0V13M16 12.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L5 17a1.5 1.5 0 0 1 2.3-1.9L10 18M6.5 6.5a5 5 0 0 1 8-3.5',
  circleDashed: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z',
} as const;

export type IconName = keyof typeof PATHS;

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  // The designs stroke the icons inside buttons at 1.8 px; everything else uses 1.6.
  strokeWidth?: number;
};

export function Icon({ name, size = 22, color = colors.textSoft, strokeWidth = 1.6 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={PATHS[name]}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        // The dashed circle marks a story that is not created yet (frames 2a·6, 2a·8, 2a·9).
        strokeDasharray={name === 'circleDashed' ? '2.6 2.4' : undefined}
      />
    </Svg>
  );
}
