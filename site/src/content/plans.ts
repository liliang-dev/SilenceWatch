/**
 * The plans of the hosted service, and what each one allows.
 *
 * Written once: the pricing page is built from it in both languages. The same
 * numbers are what the hosted deployment's `PLAN_LIMITS` setting carries, so a
 * change of plan is a change here, there, and in the Stripe price.
 *
 * Self-hosting has no plan and no limit; nothing here applies to it.
 */
export interface Plan {
  id: 'free' | 'pro' | 'business';
  /** Euros per month. */
  price: number;
  checks: number;
  projects: number;
  channelsPerProject: number;
  retentionDays: number;
}

export const PLANS: readonly Plan[] = [
  { id: 'free', price: 0, checks: 10, projects: 2, channelsPerProject: 2, retentionDays: 7 },
  { id: 'pro', price: 4.99, checks: 100, projects: 5, channelsPerProject: 5, retentionDays: 30 },
  { id: 'business', price: 9.99, checks: 1000, projects: 20, channelsPerProject: 20, retentionDays: 90 },
];

export interface PricingCopy {
  title: string;
  lede: string;
  perMonth: string;
  names: Record<Plan['id'], string>;
  limits: {
    checks: (n: number) => string;
    projects: (n: number) => string;
    channels: (n: number) => string;
    retention: (n: number) => string;
  };
  cta: Record<Plan['id'], string>;
  note: string;
  same: { title: string; items: string[] };
  selfHosted: { title: string; text: string; link: string };
  faq: { title: string; heading: string; items: { q: string; a: string }[] };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const pricing: Record<'en' | 'fr', PricingCopy> = {
  en: {
    title: 'Pricing',
    lede: 'Start free, and move up when you need more checks. Every plan has the same features; only the limits change.',
    perMonth: '/ month',
    names: { free: 'Free', pro: 'Pro', business: 'Business' },
    limits: {
      checks: (n) => `${n} ${plural(n, 'check', 'checks')}`,
      projects: (n) => `${n} ${plural(n, 'project', 'projects')}`,
      channels: (n) => `${n} alert ${plural(n, 'channel', 'channels')} per project`,
      retention: (n) => `${n} days of history`,
    },
    cta: { free: 'Start free', pro: 'Choose Pro', business: 'Choose Business' },
    note: 'Prices are in euros, per month. Taxes that apply are shown before you pay. You subscribe from Settings, once signed in with your free account.',
    same: {
      title: 'On every plan',
      items: [
        'Cron, interval and heartbeat checks',
        'Alerts by email, webhook, Slack, Microsoft Teams and Discord',
        'REST API and API keys',
        'The Spring Boot starter',
        'As many people as you want in a project',
      ],
    },
    selfHosted: {
      title: 'Self-hosting has no limit',
      text: 'The open source edition (Apache 2.0) has no plan, no quota and no reserved feature. Run it on your own server, free, with as many checks as it can carry.',
      link: 'Self-host SilenceWatch',
    },
    faq: {
      title: 'Questions about SilenceWatch pricing',
      heading: 'Questions',
      items: [
        {
          q: 'What happens when I reach a limit?',
          a: 'You cannot create more of what the limit covers (checks, projects or alert channels) until you remove some or move to a larger plan. Everything that already exists keeps working.',
        },
        {
          q: 'What happens to my checks if I move to a smaller plan?',
          a: 'Checks above the new limit are paused, the most recent first, and you receive an email listing them. Nothing is deleted and their history is kept. They resume on their own when you are back under the limit.',
        },
        {
          q: 'What does the history limit mean?',
          a: 'It is how long the pings of a check are kept. Older ones are deleted by the daily purge. A project can ask for a shorter history, never for a longer one than its plan allows.',
        },
        {
          q: 'Can I cancel at any time?',
          a: 'Yes. You cancel from Settings, and your account goes back to the Free plan at the end of the period you have paid for.',
        },
        {
          q: 'Which limits count for a project I was invited to?',
          a: 'The plan of the project’s owner. Being invited into someone else’s project does not use your own allowance.',
        },
      ],
    },
  },
  fr: {
    title: 'Tarifs',
    lede: 'Commencez gratuitement, passez à l’offre supérieure quand il vous faut plus de checks. Toutes les offres ont les mêmes fonctions ; seules les limites changent.',
    perMonth: '/ mois',
    names: { free: 'Gratuit', pro: 'Pro', business: 'Business' },
    limits: {
      checks: (n) => `${n} ${plural(n, 'check', 'checks')}`,
      projects: (n) => `${n} ${plural(n, 'projet', 'projets')}`,
      channels: (n) => `${n} ${plural(n, 'canal', 'canaux')} d’alerte par projet`,
      retention: (n) => `${n} jours d’historique`,
    },
    cta: { free: 'Commencer', pro: 'Choisir Pro', business: 'Choisir Business' },
    note: 'Les prix sont en euros, par mois. Les taxes applicables sont affichées avant le paiement. Vous vous abonnez depuis les paramètres, une fois connecté avec votre compte gratuit.',
    same: {
      title: 'Dans toutes les offres',
      items: [
        'Checks cron, intervalle et heartbeat',
        'Alertes par e-mail, webhook, Slack, Microsoft Teams et Discord',
        'API REST et clés d’API',
        'Le starter Spring Boot',
        'Autant de personnes que vous voulez dans un projet',
      ],
    },
    selfHosted: {
      title: 'L’auto-hébergement n’a aucune limite',
      text: 'L’édition open source (Apache 2.0) n’a ni offre, ni quota, ni fonction réservée. Installez-la sur votre serveur, gratuitement, avec autant de checks qu’il peut en porter.',
      link: 'Auto-héberger SilenceWatch',
    },
    faq: {
      title: 'Questions sur les tarifs de SilenceWatch',
      heading: 'Questions',
      items: [
        {
          q: 'Que se passe-t-il quand j’atteins une limite ?',
          a: 'Vous ne pouvez plus créer ce que la limite couvre (checks, projets ou canaux d’alerte) tant que vous n’en supprimez pas ou que vous ne passez pas à une offre plus grande. Ce qui existe déjà continue de fonctionner.',
        },
        {
          q: 'Que deviennent mes checks si je passe à une offre plus petite ?',
          a: 'Les checks au-delà de la nouvelle limite sont mis en pause, les plus récents d’abord, et vous recevez un e-mail qui les liste. Rien n’est supprimé et leur historique est conservé. Ils reprennent d’eux-mêmes dès que vous repassez sous la limite.',
        },
        {
          q: 'Que signifie la limite d’historique ?',
          a: 'C’est la durée pendant laquelle les pings d’un check sont conservés. Les plus anciens sont supprimés par la purge quotidienne. Un projet peut demander un historique plus court, jamais plus long que ce que son offre permet.',
        },
        {
          q: 'Puis-je résilier à tout moment ?',
          a: 'Oui. Vous résiliez depuis les paramètres, et votre compte repasse à l’offre gratuite à la fin de la période que vous avez payée.',
        },
        {
          q: 'Quelles limites comptent pour un projet auquel j’ai été invité ?',
          a: 'Celles de l’offre du propriétaire du projet. Être invité dans le projet de quelqu’un d’autre n’entame pas votre propre quota.',
        },
      ],
    },
  },
};
