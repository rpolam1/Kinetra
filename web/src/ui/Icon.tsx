import { ICONS } from './icons';
import type { IconName } from './icons';

interface IconProps {
  name: IconName;
  className?: string;
  spin?: boolean;
  label?: string;
}

export function Icon({ name, className = '', spin = false, label }: IconProps) {
  const [width, height, , , path] = ICONS[name].icon;
  const paths = Array.isArray(path) ? path : [path];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      fill="currentColor"
      focusable="false"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-icon={name}
      className={`inline-block h-[1em] w-[1em] shrink-0 align-[-0.125em] ${spin ? 'animate-spin' : ''} ${className}`}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
