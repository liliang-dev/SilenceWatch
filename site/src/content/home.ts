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
  features: { title: string; items: { icon: string; title: string; text: string }[] };
  stats: { value: string; label: string }[];
  which: { title: string; text: string; chips: { text: string; href: string }[] };
  spring: { title: string; text: string; discovered: string; jobs: { name: string; schedule: string }[] };
  hosted: { title: string; text: string; secondary: string; source: string };
  cta: { title: string; text: string; primary: string; secondary: string; note: string };
  faq: { title: string; heading: string; items: { q: string; a: string }[] };
}

export const home: Record<'en' | 'fr', HomeCopy> = {
  en: {
    app: 'Open the app, it’s free',
    trust: ['Free to use', 'Open source · Apache 2.0', 'One HTTP call to set up', 'No card needed'],
    demo: {
      caption: 'Your jobs ping SilenceWatch. When one goes quiet, you hear about it within seconds.',
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
      title: 'A job that silently stops looks exactly like a job with nothing to do',
      paragraphs: [
        'A nightly backup, an export, a certificate renewal, a billing run, a worker: when one of these **scheduled jobs** stops running, no error is raised and nobody is told. It is sometimes noticed weeks later, by whoever needed yesterday’s data.',
        'Ordinary **job monitoring** watches for what went wrong. SilenceWatch watches for **what did not happen**: it is a *dead man’s switch*. You declare how often a task should run and how late it may be. If it does not check in on time, the alert goes out.',
      ],
    },
    how: {
      title: 'Job monitoring in three steps',
      lead: 'From nothing to your first alert in a few minutes.',
      steps: [
        {
          title: 'Declare the job',
          text: 'Create a check with its frequency (every 15 minutes) or its cron expression (`0 2 * * *`), its time zone and the lateness you tolerate. See [job monitoring](/job-monitoring/).',
        },
        {
          title: 'Call the ping URL when the job finishes',
          text: 'A plain HTTP request; `curl` is enough. The endpoints (`/start`, `/fail`, exit code, duration) are in the [ping API documentation](/docs/ping-api/).',
        },
        {
          title: 'Get alerted if it does not arrive',
          text: 'The check goes late, then down; an incident opens and every enabled channel is notified. The next ping resolves the incident and sends a recovery alert.',
        },
      ],
      note: 'Copy-paste examples for crontab, systemd, Docker, Kubernetes and GitHub Actions are in the [examples](/docs/cron-examples/).',
      codeLabel: 'crontab',
    },
    features: {
      title: 'What SilenceWatch does',
      items: [
        { icon: 'clock', title: 'Cron and intervals', text: 'A fixed period or a 5- or 6-field cron expression, with a time zone, plus a grace period. See also [cron job monitoring](/cron-monitoring/).' },
        { icon: 'bolt', title: 'Detection every 10 seconds', text: 'A late check is spotted within seconds, without scanning the whole database: the cost follows the late checks, not the total.' },
        { icon: 'bell', title: 'Alerts where you are', text: 'Email, signed webhook (HMAC-SHA256), Slack, Microsoft Teams and Discord, with a test button to verify each channel before an incident does.' },
        { icon: 'leaf', title: 'Spring Boot starter', text: 'One dependency and an API key: every `@Scheduled` method and every Quartz job declares itself. See [Spring Boot](/spring-boot/).' },
        { icon: 'list', title: 'History and incidents', text: 'Every ping (duration, exit code, job output), every incident and every alert sent, with search, sorting and filters.' },
        { icon: 'key', title: 'REST API and keys', text: 'Create and manage checks through the API, with project-scoped keys, environments and separate projects.' },
      ],
    },
    stats: [
      { value: '10 s', label: 'detection loop' },
      { value: '1', label: 'HTTP call to integrate' },
      { value: '5', label: 'alert channels' },
      { value: 'Apache 2.0', label: 'open source, nothing held back' },
    ],
    which: {
      title: 'Which jobs?',
      text: 'Anything that must run at regular intervals and whose absence matters. If the job can call a URL, it can be monitored. The [job monitoring guide](/job-monitoring/) covers what to watch, and [what a dead man’s switch is](/dead-mans-switch/) explains the principle.',
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
      text: 'At startup the starter reads the tasks **Spring itself scheduled** (with the cron expressions as they actually resolved) and the Quartz jobs, declares them to SilenceWatch, then sends a heartbeat around every run, with its duration and any exception. It never fails and never blocks your job. [All about Spring Boot monitoring](/spring-boot/).',
      discovered: 'Declared at startup',
      jobs: [
        { name: 'BackupJob.run', schedule: '0 0 2 * * *' },
        { name: 'ExportJob.run', schedule: 'every 15 min' },
        { name: 'InvoiceJob.generate', schedule: '0 0 6 1 * *' },
      ],
    },
    hosted: {
      title: 'Hosted or self-hosted, never crippled',
      text: 'SilenceWatch is released under the **Apache 2.0** licence. Use the hosted service at [app.silencewatch.com](https://app.silencewatch.com), which is free, or [self-host it](/self-hosted/): one container and one PostgreSQL database, nothing else. There is no “enterprise edition” and no reserved feature.',
      secondary: 'Self-host',
      source: 'Source code',
    },
    cta: {
      title: 'Your next silent failure shouldn’t be silent',
      text: 'Create an account, add a check, paste one line in your crontab. It takes a few minutes, and it’s free.',
      primary: 'Open the app, it’s free',
      secondary: 'Read the quickstart',
      note: 'Prefer your own server?',
    },
    faq: {
      title: 'Frequently asked questions about SilenceWatch',
      heading: 'Frequently asked questions',
      items: [
        {
          q: 'What is job monitoring?',
          a: 'It is watching that your jobs and scheduled tasks, cron jobs included, actually run. Rather than looking for errors, it checks that each job checks in at its expected time, and alerts when it does not. SilenceWatch does it with one HTTP call at the end of the job.',
        },
        {
          q: 'Is SilenceWatch free?',
          a: 'Yes. The hosted service at app.silencewatch.com is free to use, and the self-hosted edition is free and open source under the Apache 2.0 licence, with no reserved feature.',
        },
        {
          q: 'How do I monitor a job that does not crash but stops running?',
          a: 'With a dead man’s switch: the job sends a heartbeat (a ping) on every run, and SilenceWatch alerts you if it does not arrive within the expected window. It is the only way to detect an absence, because a job that does not run produces no error.',
        },
        {
          q: 'Does SilenceWatch work with crontab, systemd and Kubernetes?',
          a: 'Yes. Anything that can make an HTTP request works: crontab, systemd timers, Kubernetes CronJobs, GitHub Actions, and Bash, Python, Node or Java scripts. Examples are in the documentation.',
        },
        {
          q: 'Can Spring Boot @Scheduled tasks be monitored automatically?',
          a: 'Yes. The SilenceWatch Spring Boot starter discovers @Scheduled methods and Quartz jobs at startup, declares them with their real schedule, and sends a heartbeat around every run, with no per-job configuration.',
        },
        {
          q: 'Can I self-host SilenceWatch?',
          a: 'Yes. SilenceWatch is open source under the Apache 2.0 licence and installs with Docker: one container and one PostgreSQL database. The self-hosted edition is never crippled.',
        },
        {
          q: 'Which alert channels are available?',
          a: 'Email, webhook (signed with HMAC-SHA256), Slack, Microsoft Teams and Discord. Each channel can be tested from the interface, and a recovery alert is sent when the job resumes.',
        },
      ],
    },
  },

  fr: {
    app: 'Ouvrir l’application, c’est gratuit',
    trust: ['Gratuit', 'Open source · Apache 2.0', 'Un seul appel HTTP à ajouter', 'Aucune carte demandée'],
    demo: {
      caption: 'Vos jobs envoient un signal à SilenceWatch. Quand l’un se tait, vous le savez en quelques secondes.',
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
      title: 'Un job qui s’arrête en silence ressemble à un job qui n’a rien à faire',
      paragraphs: [
        'Une sauvegarde nocturne, un export, un renouvellement de certificat, une facturation, un worker : quand l’un de ces **jobs planifiés** cesse de tourner, aucune erreur n’est levée et personne n’est prévenu. On s’en aperçoit parfois des semaines plus tard, quand quelqu’un a besoin des données d’hier.',
        'Le **monitoring de jobs** classique surveille ce qui s’est mal passé. SilenceWatch surveille **ce qui ne s’est pas passé** : c’est un *dead man’s switch*. Vous déclarez à quelle fréquence un job doit s’exécuter et quel retard vous tolérez. S’il ne donne pas signe de vie à temps, l’alerte part.',
      ],
    },
    how: {
      title: 'Le monitoring de jobs en trois étapes',
      lead: 'De rien à votre première alerte en quelques minutes.',
      steps: [
        {
          title: 'Déclarez le job',
          text: 'Créez un check avec sa fréquence (toutes les 15 minutes) ou son expression cron (`0 2 * * *`), son fuseau horaire et le retard toléré. Voir le [monitoring de jobs](/job-monitoring/).',
        },
        {
          title: 'Appelez l’URL de ping à la fin du job',
          text: 'Une simple requête HTTP, `curl` suffit. Le détail des points d’entrée (`/start`, `/fail`, code de sortie, durée) est dans la [documentation de l’API de ping](/docs/ping-api/).',
        },
        {
          title: 'Soyez alerté si elle n’arrive pas',
          text: 'Le check passe en retard, puis en panne ; un incident s’ouvre et chaque canal activé est prévenu. Un ping suivant résout l’incident et envoie une alerte de retour à la normale.',
        },
      ],
      note: 'Des exemples prêts à copier pour crontab, systemd, Docker, Kubernetes et GitHub Actions sont dans les [exemples](/docs/cron-examples/).',
      codeLabel: 'crontab',
    },
    features: {
      title: 'Ce que fait SilenceWatch',
      items: [
        { icon: 'clock', title: 'Cron et intervalles', text: 'Une fréquence fixe ou une expression cron à 5 ou 6 champs, avec fuseau horaire, plus un délai de grâce. Voir aussi le [monitoring de cron](/cron-monitoring/).' },
        { icon: 'bolt', title: 'Détection toutes les 10 secondes', text: 'Un check en retard est repéré en quelques secondes, sans balayer toute la base : le coût dépend des checks en retard, pas du nombre total.' },
        { icon: 'bell', title: 'Alertes là où vous êtes', text: 'E-mail, webhook signé (HMAC-SHA256), Slack, Microsoft Teams et Discord, avec un bouton de test pour vérifier chaque canal avant qu’un incident n’arrive.' },
        { icon: 'leaf', title: 'Starter Spring Boot', text: 'Une dépendance et une clé d’API : chaque `@Scheduled` et chaque job Quartz se déclare tout seul. Voir [Spring Boot](/spring-boot/).' },
        { icon: 'list', title: 'Historique et incidents', text: 'Chaque ping (durée, code de sortie, sortie du job), chaque incident et chaque alerte envoyée, avec recherche, tri et filtres.' },
        { icon: 'key', title: 'API REST et clés', text: 'Créez et pilotez vos checks par API, avec des clés limitées à un projet, des environnements et des projets séparés.' },
      ],
    },
    stats: [
      { value: '10 s', label: 'boucle de détection' },
      { value: '1', label: 'appel HTTP pour intégrer' },
      { value: '5', label: 'canaux d’alerte' },
      { value: 'Apache 2.0', label: 'open source, rien de retenu' },
    ],
    which: {
      title: 'Pour quels jobs ?',
      text: 'Tout ce qui doit tourner à intervalle régulier et dont l’absence compte. Si le job peut appeler une URL, il peut être surveillé. Le [guide du monitoring de jobs](/job-monitoring/) détaille quoi surveiller, et [ce qu’est un dead man’s switch](/dead-mans-switch/) explique le principe.',
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
      text: 'Au démarrage, le starter lit les tâches **déjà planifiées par Spring** (avec les expressions cron réellement résolues) et les jobs Quartz, les déclare à SilenceWatch, puis envoie un signal autour de chaque exécution, en y joignant la durée et l’éventuelle exception. Il ne fait jamais échouer et ne bloque jamais votre job. [Tout sur le monitoring Spring Boot](/spring-boot/).',
      discovered: 'Déclarés au démarrage',
      jobs: [
        { name: 'BackupJob.run', schedule: '0 0 2 * * *' },
        { name: 'ExportJob.run', schedule: 'toutes les 15 min' },
        { name: 'InvoiceJob.generate', schedule: '0 0 6 1 * *' },
      ],
    },
    hosted: {
      title: 'Hébergé ou auto-hébergé, sans version bridée',
      text: 'SilenceWatch est publié sous licence **Apache 2.0**. Vous pouvez l’utiliser en service hébergé sur [app.silencewatch.com](https://app.silencewatch.com), gratuit, ou l’[auto-héberger](/self-hosted/) : un conteneur et une base PostgreSQL, rien d’autre. Il n’y a ni édition « entreprise » ni fonction réservée.',
      secondary: 'Auto-héberger',
      source: 'Code source',
    },
    cta: {
      title: 'Votre prochaine panne silencieuse ne le sera plus',
      text: 'Créez un compte, ajoutez un check, collez une ligne dans votre crontab. Quelques minutes suffisent, et c’est gratuit.',
      primary: 'Ouvrir l’application, c’est gratuit',
      secondary: 'Lire le démarrage rapide',
      note: 'Vous préférez votre propre serveur ?',
    },
    faq: {
      title: 'Questions fréquentes sur SilenceWatch',
      heading: 'Questions fréquentes',
      items: [
        {
          q: 'Qu’est-ce que le monitoring de jobs ?',
          a: 'C’est la surveillance de l’exécution de vos jobs et tâches planifiées, crons compris. Plutôt que de chercher des erreurs, on vérifie que chaque job donne signe de vie à l’heure prévue, et on alerte quand il ne le fait pas. SilenceWatch le fait avec un simple appel HTTP à la fin du job.',
        },
        {
          q: 'SilenceWatch est-il gratuit ?',
          a: 'Oui. Le service hébergé sur app.silencewatch.com est gratuit, et l’édition auto-hébergée est gratuite et open source sous licence Apache 2.0, sans fonction réservée.',
        },
        {
          q: 'Comment surveiller un job qui ne plante pas mais ne s’exécute plus ?',
          a: 'Avec un dead man’s switch : le job envoie un signal (un ping) à chaque exécution, et SilenceWatch vous alerte si le signal n’arrive pas dans le délai prévu. C’est le seul moyen de détecter une absence, puisqu’un job qui ne tourne pas ne produit aucune erreur.',
        },
        {
          q: 'SilenceWatch fonctionne-t-il avec crontab, systemd et Kubernetes ?',
          a: 'Oui. Tout ce qui peut faire une requête HTTP convient : crontab, minuteurs systemd, CronJob Kubernetes, GitHub Actions, scripts Bash, Python, Node ou Java. Des exemples sont donnés dans la documentation.',
        },
        {
          q: 'Peut-on surveiller les @Scheduled de Spring Boot automatiquement ?',
          a: 'Oui. Le starter Spring Boot de SilenceWatch découvre les méthodes @Scheduled et les jobs Quartz au démarrage, les déclare avec leur vraie planification, et envoie un signal autour de chaque exécution, sans configuration par job.',
        },
        {
          q: 'Peut-on auto-héberger SilenceWatch ?',
          a: 'Oui. SilenceWatch est open source sous licence Apache 2.0 et s’installe avec Docker : un conteneur et une base PostgreSQL. L’édition auto-hébergée n’est jamais bridée.',
        },
        {
          q: 'Quels canaux d’alerte sont disponibles ?',
          a: 'E-mail, webhook (signé en HMAC-SHA256), Slack, Microsoft Teams et Discord. Chaque canal peut être testé depuis l’interface, et une alerte de retour à la normale est envoyée quand le job reprend.',
        },
      ],
    },
  },
};
