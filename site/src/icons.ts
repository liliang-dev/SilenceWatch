/**
 * The icons of the home page, from Google's Material Icons (the "outlined" set,
 * Apache-2.0): the same set Angular Material uses, taken from the
 * `@material-design-icons/svg` package rather than drawn here.
 *
 * Each one is read as text at build time and inlined, so the page makes no request
 * for an icon font or a file and each icon takes its colour from the text around
 * it. Only the icons listed here end up in the page.
 */
import bedtime from '@material-design-icons/svg/outlined/bedtime.svg?raw';
import bolt from '@material-design-icons/svg/outlined/bolt.svg?raw';
import cloudDone from '@material-design-icons/svg/outlined/cloud_done.svg?raw';
import dns from '@material-design-icons/svg/outlined/dns.svg?raw';
import help from '@material-design-icons/svg/outlined/help.svg?raw';
import leaf from '@material-design-icons/svg/outlined/energy_savings_leaf.svg?raw';
import lightbulb from '@material-design-icons/svg/outlined/lightbulb.svg?raw';
import history from '@material-design-icons/svg/outlined/manage_history.svg?raw';
import mail from '@material-design-icons/svg/outlined/mail.svg?raw';
import notifications from '@material-design-icons/svg/outlined/notifications.svg?raw';
import notificationsOff from '@material-design-icons/svg/outlined/notifications_off.svg?raw';
import receipt from '@material-design-icons/svg/outlined/receipt_long.svg?raw';
import schedule from '@material-design-icons/svg/outlined/schedule.svg?raw';
import settings from '@material-design-icons/svg/outlined/settings.svg?raw';
import storage from '@material-design-icons/svg/outlined/storage.svg?raw';
import swap from '@material-design-icons/svg/outlined/swap_horiz.svg?raw';
import tag from '@material-design-icons/svg/outlined/tag.svg?raw';
import verified from '@material-design-icons/svg/outlined/verified.svg?raw';
import cube from '@material-design-icons/svg/outlined/view_in_ar.svg?raw';
import key from '@material-design-icons/svg/outlined/vpn_key.svg?raw';
import webhook from '@material-design-icons/svg/outlined/webhook.svg?raw';

const icons = {
  bedtime,
  bolt,
  cloudDone,
  cube,
  dns,
  help,
  history,
  key,
  leaf,
  lightbulb,
  mail,
  notifications,
  notificationsOff,
  receipt,
  schedule,
  settings,
  storage,
  swap,
  tag,
  verified,
  webhook,
} as const;

export type IconName = keyof typeof icons;

/** What is inside the icon's <svg>: its paths, ready to nest in a drawing of our own. */
export function iconBody(name: IconName): string {
  const match = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(icons[name]);
  if (match === null) throw new Error(`The icon "${name}" is not an SVG`);
  return match[1] as string;
}
