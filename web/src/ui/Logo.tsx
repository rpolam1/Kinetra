import { useState } from 'react';
import { env } from '../config/env';

// The base URL is included so the logo also loads when the app is served from a sub folder
export const LOGO_URL = `${env.baseUrl}logo.png`;
export const APP_NAME = 'Kinetra';

interface LogoProps {
  height?: number;
  withName?: boolean;
  className?: string;
}

/** The logo image. If the image fails to load, the app name is shown as text instead. */
export function Logo({ height = 36, withName = false, className = '' }: LogoProps) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      {failed ? null : (
        <img src={LOGO_URL} alt={withName ? '' : APP_NAME} height={height} style={{ height, width: 'auto' }} onError={() => setFailed(true)} draggable={false} />
      )}
      {withName || failed ? <span className="font-display text-lg font-semibold tracking-tight text-white">{APP_NAME}</span> : null}
    </span>
  );
}
