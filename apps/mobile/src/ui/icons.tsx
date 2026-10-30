import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme/tokens';

// Generic line icons, drawn for this app on a 24 x 24 grid with a 1.6 px stroke.
const PATHS = {
  // The chevron from the designs (sign-in, sign-up and every reset step use this one).
  back: 'M15 6l-6 6 6 6',
  check: 'M4.5 12.5l5 5 10-11',
  play: 'M7 4.5v15l12.5-7.5z',
  bell: 'M12 3.5c-3.3 0-5.5 2.4-5.5 5.6v3.3L5 15.5h14l-1.5-3.1V9.1c0-3.2-2.2-5.6-5.5-5.6zM9.8 18.5a2.3 2.3 0 0 0 4.4 0',
} as const;

export type IconName = keyof typeof PATHS;

type Props = {
  name: IconName;
  size?: number;
  color?: string;
};

export function Icon({ name, size = 22, color = colors.textSoft }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={PATHS[name]}
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
