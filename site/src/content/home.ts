/**
 * The words of the home page, in both languages, in one place.
 *
 * The page is built from components (`Home.astro`, `LiveDemo.astro`) so that it
 * can be laid out and animated; the text lives here so the two languages keep the
 * same structure and cannot drift apart. Inline markup is limited to what `md()`
 * in `Home.astro` understands: `[text](/path/)` (a path of the site, or a full
 * address), `**bold**` and `` `code` ``. Internal paths are written without the
 * language prefix.
 *
 * Nothing here talks about price beyond "free": the hosted service is free for
 * now, and there is no plan, tier or subscription to describe.
 */
export interface HomeCopy {
  app: string;
  trust: string[];
  demo: {
    caption: string;
    window: string;
    rows: { name: string; meta: string }[];
    flaky: string;
    states: { up: string; late: string; down: string };
    whens: { up: string; late: string; down: string };
    toastDown: { title: string; text: string };
    toastUp: { title: string; text: string };
  };
  works: { label: string; items: string[] };
  problem: { title: string; paragraphs: string[] };
  how: {
    title: string;
    lead: string;
    steps: { title: string; text: string }[];
    note: string;
    codeLabel: string;
  };
  /** `icon` is the name of an icon in `src/icons.ts`. */
  features: { title: string; items: { icon: string; title: string; text: string }[] };
  which: { title: string; text: string; chips: { text: string; href: string }[] };
  spring: { title: string; text: string; discovered: string; jobs: { name: string; schedule: string }[] };
  hosted: { title: string; text: string; secondary: string; source: string };
  cta: { title: string; text: string };
  faq: { title: string; heading: string; items: { q: string; a: string }[] };
}

export const home: Record<'en' | 'fr', HomeCopy> = {
  en: {
    app: 'Try it out',
    trust: ['Free', 'Open source', 'One HTTP call'],
    demo: {
      caption: 'A job goes quiet. You know within seconds.',
      window: 'Checks',
      rows: [
        { name: 'Nightly backup', meta: '6 hours ago · 1 min 12 s' },
        { name: 'Certificate renewal', meta: '2 days ago' },
      ],
      flaky: 'Payments reconciliation',
      states: { up: 'UP', late: 'LATE', down: 'DOWN' },
      whens: { up: 'ping received 2 min ago', late: 'expected 1 min ago', down: 'no ping for 6 min' },
      toastDown: { title: 'Payments reconciliation is DOWN', text: 'Alert sent · Slack, email' },
      toastUp: { title: 'Payments reconciliation is back', text: 'Ping received · recovery sent' },
    },
    works: {
      label: 'Works with anything that can call a URL',
      items: ['crontab', 'systemd timers', 'Kubernetes CronJobs', 'GitHub Actions', 'Spring Boot', 'Quartz', 'Docker', 'Bash', 'Python', 'Node.js', 'PowerShell', 'Java'],
    },
    problem: {
      title: 'A job that stops silently looks like a job with nothing to do',
      paragraphs: [
        'Backups, exports, renewals, billing runs: when a **scheduled job** stops, no error is raised and nobody is told.',
        'SilenceWatch is a *dead man’s switch*. It watches for **what did not happen**: if a job does not check in on time, the alert goes out.',
      ],
    },
    how: {
      title: 'Job monitoring in three steps',
      lead: 'Your first alert in a few minutes.',
      steps: [
        {
          title: 'Declare the job',
          text: 'Set a frequency or a cron expression, a time zone and the delay you tolerate. See [job monitoring](/job-monitoring/).',
        },
        {
          title: 'Ping when it finishes',
          text: 'One `curl` at the end of the job. See the [ping API](/docs/ping-api/).',
        },
        {
          title: 'Get alerted',
          text: 'No ping in time: an incident opens and your channels are notified. The next ping resolves it.',
        },
      ],
      note: 'Ready-to-copy [examples](/docs/cron-examples/) for crontab, systemd, Docker, Kubernetes and GitHub Actions.',
      codeLabel: 'crontab',
    },
    features: {
      title: 'What SilenceWatch does',
      items: [
        { icon: 'schedule', title: 'Cron and intervals', text: 'A period or a cron expression, with a time zone and a grace period. See [cron monitoring](/cron-monitoring/).' },
        { icon: 'bolt', title: 'Detection every 10 seconds', text: 'A late check is spotted within seconds.' },
        { icon: 'notifications', title: 'Alerts where you are', text: 'Email, webhook, Slack, Teams and Discord, each testable in one click.' },
        { icon: 'leaf', title: 'Spring Boot starter', text: 'One dependency: every `@Scheduled` job declares itself. See [Spring Boot](/spring-boot/).' },
        { icon: 'history', title: 'History and incidents', text: 'Every ping, incident and alert, searchable.' },
        { icon: 'key', title: 'REST API and keys', text: 'Manage checks through the API, with project-scoped keys.' },
      ],
    },
    which: {
      title: 'Which jobs?',
      text: 'Anything that must run regularly and whose absence matters. If it can call a URL, it can be monitored. See [what a dead man’s switch is](/dead-mans-switch/).',
      chips: [
        { text: 'Backups', href: '/guides/backup-monitoring/' },
        { text: 'Kubernetes CronJobs', href: '/guides/kubernetes-cronjob-monitoring/' },
        { text: 'A cron job that does not run', href: '/guides/cron-not-running/' },
        { text: 'Data imports and exports', href: '/job-monitoring/' },
        { text: 'Billing runs', href: '/job-monitoring/' },
        { text: 'Certificate renewals', href: '/job-monitoring/' },
        { text: 'Workers and purges', href: '/job-monitoring/' },
      ],
    },
    spring: {
      title: 'Spring Boot: nothing to declare by hand',
      text: 'The starter reads your `@Scheduled` tasks and Quartz jobs at startup, declares them, and pings around every run. It never blocks your job. See [Spring Boot monitoring](/spring-boot/).',
      discovered: 'Declared at startup',
      jobs: [
        { name: 'BackupJob.run', schedule: '0 0 2 * * *' },
        { name: 'ExportJob.run', schedule: 'every 15 min' },
        { name: 'InvoiceJob.generate', schedule: '0 0 6 1 * *' },
      ],
    },
    hosted: {
      title: 'Hosted or self-hosted',
      text: 'Open source under **Apache 2.0**. Use the hosted service, free, or [self-host it](/self-hosted/): one container and one PostgreSQL database.',
      secondary: 'Self-host',
      source: 'Source code',
    },
    cta: {
      title: 'Your next silent failure shouldn’t be silent',
      text: 'Get alerted by email or on any webhook.',
    },
    faq: {
      title: 'Frequently asked questions about SilenceWatch',
      heading: 'Frequently asked questions',
      items: [
        {
          q: 'What is job monitoring?',
          a: 'Checking that scheduled jobs, cron jobs included, actually run. Each job pings SilenceWatch when it finishes, and you are alerted when a ping does not arrive.',
        },
        {
          q: 'Is SilenceWatch free?',
          a: 'Yes. The hosted service is free, and the self-hosted edition is free and open source (Apache 2.0), with no reserved feature.',
        },
        {
          q: 'How do I monitor a job that does not crash but stops running?',
          a: 'Use a dead man’s switch: the job pings on every run, and SilenceWatch alerts you when a ping is missing. It is the only way to detect an absence.',
        },
        {
          q: 'Does SilenceWatch work with crontab, systemd and Kubernetes?',
          a: 'Yes. Anything that can make an HTTP request works: crontab, systemd, Kubernetes, GitHub Actions, scripts.',
        },
        {
          q: 'Can Spring Boot @Scheduled tasks be monitored automatically?',
          a: 'Yes. The starter discovers @Scheduled methods and Quartz jobs at startup and pings around every run, with no per-job configuration.',
        },
        {
          q: 'Can I self-host SilenceWatch?',
          a: 'Yes, with Docker: one container and one PostgreSQL database, under the Apache 2.0 licence.',
        },
        {
          q: 'Which alert channels are available?',
          a: 'Email, webhook (signed with HMAC-SHA256), Slack, Microsoft Teams and Discord, each testable from the interface.',
        },
      ],
    },
  },

  fr: {
    app: 'Essayer',
    trust: ['Gratuit', 'Open source', 'Un seul appel HTTP'],
    demo: {
      caption: 'Un job se tait. Vous le savez en quelques secondes.',
      window: 'Checks',
      rows: [
        { name: 'Sauvegarde nocturne', meta: 'il y a 6 h · 1 min 12 s' },
        { name: 'Renouvellement du certificat', meta: 'il y a 2 j' },
      ],
      flaky: 'Paiements : rapprochement',
      states: { up: 'OK', late: 'EN RETARD', down: 'EN PANNE' },
      whens: { up: 'ping reçu il y a 2 min', late: 'attendu il y a 1 min', down: 'aucun ping depuis 6 min' },
      toastDown: { title: 'Paiements : rapprochement est EN PANNE', text: 'Alerte envoyée · Slack, e-mail' },
      toastUp: { title: 'Paiements : rapprochement est revenu', text: 'Ping reçu · retour à la normale envoyé' },
    },
    works: {
      label: 'Fonctionne avec tout ce qui peut appeler une URL',
      items: ['crontab', 'minuteurs systemd', 'CronJobs Kubernetes', 'GitHub Actions', 'Spring Boot', 'Quartz', 'Docker', 'Bash', 'Python', 'Node.js', 'PowerShell', 'Java'],
    },
    problem: {
      title: 'Un job qui s’arrête en silence ressemble à un job sans rien à faire',
      paragraphs: [
        'Sauvegardes, exports, renouvellements, facturation : quand un **job planifié** s’arrête, aucune erreur n’est levée et personne n’est prévenu.',
        'SilenceWatch est un *dead man’s switch*. Il surveille **ce qui ne s’est pas passé** : si un job ne donne pas signe de vie à temps, l’alerte part.',
      ],
    },
    how: {
      title: 'Le monitoring de jobs en trois étapes',
      lead: 'Votre première alerte en quelques minutes.',
      steps: [
        {
          title: 'Déclarez le job',
          text: 'Indiquez une fréquence ou une expression cron, un fuseau horaire et le retard toléré. Voir le [monitoring de jobs](/job-monitoring/).',
        },
        {
          title: 'Pingez à la fin',
          text: 'Un `curl` à la fin du job. Voir l’[API de ping](/docs/ping-api/).',
        },
        {
          title: 'Soyez alerté',
          text: 'Pas de ping à temps : un incident s’ouvre et vos canaux sont prévenus. Le ping suivant le résout.',
        },
      ],
      note: 'Des [exemples](/docs/cron-examples/) à copier pour crontab, systemd, Docker, Kubernetes et GitHub Actions.',
      codeLabel: 'crontab',
    },
    features: {
      title: 'Ce que fait SilenceWatch',
      items: [
        { icon: 'schedule', title: 'Cron et intervalles', text: 'Une fréquence ou une expression cron, avec fuseau horaire et délai de grâce. Voir le [monitoring de cron](/cron-monitoring/).' },
        { icon: 'bolt', title: 'Détection toutes les 10 secondes', text: 'Un check en retard est repéré en quelques secondes.' },
        { icon: 'notifications', title: 'Alertes là où vous êtes', text: 'E-mail, webhook, Slack, Teams et Discord, chacun testable en un clic.' },
        { icon: 'leaf', title: 'Starter Spring Boot', text: 'Une dépendance : chaque `@Scheduled` se déclare tout seul. Voir [Spring Boot](/spring-boot/).' },
        { icon: 'history', title: 'Historique et incidents', text: 'Chaque ping, incident et alerte, avec recherche.' },
        { icon: 'key', title: 'API REST et clés', text: 'Pilotez vos checks par API, avec des clés limitées à un projet.' },
      ],
    },
    which: {
      title: 'Pour quels jobs ?',
      text: 'Tout ce qui doit tourner régulièrement et dont l’absence compte. Si ça peut appeler une URL, ça peut être surveillé. Voir [ce qu’est un dead man’s switch](/dead-mans-switch/).',
      chips: [
        { text: 'Sauvegardes', href: '/guides/backup-monitoring/' },
        { text: 'CronJobs Kubernetes', href: '/guides/kubernetes-cronjob-monitoring/' },
        { text: 'Un cron qui ne s’exécute pas', href: '/guides/cron-not-running/' },
        { text: 'Imports et exports de données', href: '/job-monitoring/' },
        { text: 'Traitements de facturation', href: '/job-monitoring/' },
        { text: 'Renouvellements de certificats', href: '/job-monitoring/' },
        { text: 'Workers et purges', href: '/job-monitoring/' },
      ],
    },
    spring: {
      title: 'Spring Boot : zéro déclaration à la main',
      text: 'Le starter lit vos tâches `@Scheduled` et vos jobs Quartz au démarrage, les déclare, et envoie un ping autour de chaque exécution. Il ne bloque jamais votre job. Voir le [monitoring Spring Boot](/spring-boot/).',
      discovered: 'Déclarés au démarrage',
      jobs: [
        { name: 'BackupJob.run', schedule: '0 0 2 * * *' },
        { name: 'ExportJob.run', schedule: 'toutes les 15 min' },
        { name: 'InvoiceJob.generate', schedule: '0 0 6 1 * *' },
      ],
    },
    hosted: {
      title: 'Hébergé ou auto-hébergé',
      text: 'Open source sous licence **Apache 2.0**. Utilisez le service hébergé, gratuit, ou [auto-hébergez-le](/self-hosted/) : un conteneur et une base PostgreSQL.',
      secondary: 'Auto-héberger',
      source: 'Code source',
    },
    cta: {
      title: 'Votre prochaine panne silencieuse ne le sera plus',
      text: 'Soyez alerté par mail ou sur n’importe quel webhook.',
    },
    faq: {
      title: 'Questions fréquentes sur SilenceWatch',
      heading: 'Questions fréquentes',
      items: [
        {
          q: 'Qu’est-ce que le monitoring de jobs ?',
          a: 'Vérifier que vos jobs planifiés, crons compris, s’exécutent vraiment. Chaque job envoie un ping à SilenceWatch en terminant, et vous êtes alerté quand un ping n’arrive pas.',
        },
        {
          q: 'SilenceWatch est-il gratuit ?',
          a: 'Oui. Le service hébergé est gratuit, et l’édition auto-hébergée est gratuite et open source (Apache 2.0), sans fonction réservée.',
        },
        {
          q: 'Comment surveiller un job qui ne plante pas mais ne s’exécute plus ?',
          a: 'Avec un dead man’s switch : le job envoie un ping à chaque exécution, et SilenceWatch vous alerte quand il manque. C’est le seul moyen de détecter une absence.',
        },
        {
          q: 'SilenceWatch fonctionne-t-il avec crontab, systemd et Kubernetes ?',
          a: 'Oui. Tout ce qui peut faire une requête HTTP convient : crontab, systemd, Kubernetes, GitHub Actions, scripts.',
        },
        {
          q: 'Peut-on surveiller les @Scheduled de Spring Boot automatiquement ?',
          a: 'Oui. Le starter découvre les méthodes @Scheduled et les jobs Quartz au démarrage et envoie un ping autour de chaque exécution, sans configuration par job.',
        },
        {
          q: 'Peut-on auto-héberger SilenceWatch ?',
          a: 'Oui, avec Docker : un conteneur et une base PostgreSQL, sous licence Apache 2.0.',
        },
        {
          q: 'Quels canaux d’alerte sont disponibles ?',
          a: 'E-mail, webhook (signé en HMAC-SHA256), Slack, Microsoft Teams et Discord, chacun testable depuis l’interface.',
        },
      ],
    },
  },
};
