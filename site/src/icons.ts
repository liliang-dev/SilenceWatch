/**
 * The icons of the site, from Heroicons' 24px outline set (MIT, © Tailwind Labs), taken
 * from the `heroicons` package rather than drawn here. They are strokes, not filled
 * shapes: whoever draws one sets `fill="none"` and a `stroke`.
 *
 * Each one is read as text at build time and inlined, so the page makes no request
 * for an icon font or a file and each icon takes its colour from the text around
 * it. Only the icons listed here end up in the page.
 */
import arrow from 'heroicons/24/outline/arrow-right.svg?raw';
import bolt from 'heroicons/24/outline/bolt.svg?raw';
import bell from 'heroicons/24/outline/bell.svg?raw';
import clock from 'heroicons/24/outline/clock.svg?raw';
import code from 'heroicons/24/outline/code-bracket.svg?raw';
import cube from 'heroicons/24/outline/cube.svg?raw';
import envelope from 'heroicons/24/outline/envelope.svg?raw';
import help from 'heroicons/24/outline/question-mark-circle.svg?raw';
import history from 'heroicons/24/outline/arrow-path.svg?raw';
import key from 'heroicons/24/outline/key.svg?raw';
import link from 'heroicons/24/outline/link.svg?raw';
import receipt from 'heroicons/24/outline/document-text.svg?raw';
import settings from 'heroicons/24/outline/cog-6-tooth.svg?raw';
import storage from 'heroicons/24/outline/circle-stack.svg?raw';
import swap from 'heroicons/24/outline/arrows-right-left.svg?raw';
import tag from 'heroicons/24/outline/tag.svg?raw';
import verified from 'heroicons/24/outline/check-badge.svg?raw';
import desktop from 'heroicons/24/outline/computer-desktop.svg?raw';
import moon from 'heroicons/24/outline/moon.svg?raw';
import sun from 'heroicons/24/outline/sun.svg?raw';

const icons = {
  arrow,
  bolt,
  code,
  cube,
  desktop,
  help,
  history,
  key,
  mail: envelope,
  moon,
  notifications: bell,
  receipt,
  schedule: clock,
  settings,
  storage,
  sun,
  swap,
  tag,
  verified,
  webhook: link,
} as const;

export type IconName = keyof typeof icons;

/** What is inside the icon's <svg>: its paths, ready to nest in a drawing of our own. */
export function iconBody(name: IconName): string {
  const match = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(icons[name]);
  if (match === null) throw new Error(`The icon "${name}" is not an SVG`);
  return match[1] as string;
}
