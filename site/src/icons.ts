/**
 * The icons of the site, from Heroicons' solid set (MIT, © Tailwind Labs), taken
 * from the `heroicons` package rather than drawn here.
 *
 * Each one is read as text at build time and inlined, so the page makes no request
 * for an icon font or a file and each icon takes its colour from the text around
 * it. Only the icons listed here end up in the page.
 */
import arrow from 'heroicons/24/solid/arrow-right.svg?raw';
import bolt from 'heroicons/24/solid/bolt.svg?raw';
import bell from 'heroicons/24/solid/bell.svg?raw';
import clock from 'heroicons/24/solid/clock.svg?raw';
import code from 'heroicons/24/solid/code-bracket.svg?raw';
import cube from 'heroicons/24/solid/cube.svg?raw';
import envelope from 'heroicons/24/solid/envelope.svg?raw';
import help from 'heroicons/24/solid/question-mark-circle.svg?raw';
import history from 'heroicons/24/solid/arrow-path.svg?raw';
import key from 'heroicons/24/solid/key.svg?raw';
import link from 'heroicons/24/solid/link.svg?raw';
import receipt from 'heroicons/24/solid/document-text.svg?raw';
import settings from 'heroicons/24/solid/cog-6-tooth.svg?raw';
import storage from 'heroicons/24/solid/circle-stack.svg?raw';
import swap from 'heroicons/24/solid/arrows-right-left.svg?raw';
import tag from 'heroicons/24/solid/tag.svg?raw';
import verified from 'heroicons/24/solid/check-badge.svg?raw';
import desktop from 'heroicons/24/solid/computer-desktop.svg?raw';
import moon from 'heroicons/24/solid/moon.svg?raw';
import sun from 'heroicons/24/solid/sun.svg?raw';

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
