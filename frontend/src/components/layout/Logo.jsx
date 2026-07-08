/**
 * EdgeFlow - Logo (reusable inline SVG)
 */

import React from 'react';

export function Logo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="M14 22 L32 12 L50 22 L50 42 L32 52 L14 42 Z" stroke="#22d3ee" strokeWidth="3" fill="none" strokeLinejoin="round" />
      <path d="M14 22 L32 32 L50 22" stroke="#22d3ee" strokeWidth="3" strokeLinejoin="round" />
      <path d="M32 32 L32 52" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="32" r="3" fill="#67e8f9" />
    </svg>
  );
}

export default Logo;
