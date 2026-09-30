export const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Changelog', href: '#changelog' },
  { label: 'Docs', href: '#signup' },
];

export const logos = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark'];

export const features = [
  {
    icon: '⚡',
    title: 'Instant deploys',
    description: 'Push to main and your functions are live on 300+ edge locations in under ten seconds.',
  },
  {
    icon: '🔒',
    title: 'Secure by default',
    description: 'Every deploy is isolated, signed and scanned. Secrets never leave the encrypted vault.',
  },
  {
    icon: '📈',
    title: 'Real-time metrics',
    description: 'Latency, errors and cold starts streamed to your dashboard with per-route breakdowns.',
  },
  {
    icon: '🧩',
    title: 'Framework native',
    description: 'First-class adapters for Next.js, Remix, Astro and SvelteKit. No config required.',
  },
  {
    icon: '🌍',
    title: 'Global KV storage',
    description: 'Strongly consistent key-value storage replicated to every region you deploy to.',
  },
  {
    icon: '🤝',
    title: 'Team workflows',
    description: 'Preview URLs for every pull request, with comments and approvals built in.',
  },
];

export const plans = [
  {
    name: 'Hobby',
    price: '$0',
    period: '/month',
    description: 'For side projects and experiments.',
    features: ['100k requests / month', '1 team member', 'Community support'],
    cta: 'Start for free',
    featured: false,
  },
  {
    name: 'Pro',
    price: '$24',
    period: '/month',
    description: 'For production apps that need to scale.',
    features: ['10M requests / month', 'Unlimited team members', 'Preview deployments', 'Email support'],
    cta: 'Start free trial',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For organisations with advanced needs.',
    features: ['Unlimited requests', 'SSO & audit logs', '99.99% SLA', 'Dedicated engineer'],
    cta: 'Contact sales',
    featured: false,
  },
];

export const testimonials = [
  {
    quote: 'We moved our API to Nimbus in an afternoon and cut p95 latency by 60%.',
    name: 'Priya Raman',
    role: 'CTO, Lumen',
  },
  {
    quote: 'Preview deployments changed how our team reviews frontend work.',
    name: 'Marco Silva',
    role: 'Staff Engineer, Parcel',
  },
  {
    quote: 'The metrics dashboard is the first one our on-call actually likes.',
    name: 'Hannah Lee',
    role: 'SRE Lead, Northwind',
  },
];

export const changelog = [
  { version: '2.8.0', date: 'Sep 24', title: 'Streaming responses', body: 'Functions can now stream responses with backpressure.' },
  { version: '2.7.2', date: 'Sep 12', title: 'Faster cold starts', body: 'Cold starts are 35% faster thanks to snapshot restore.' },
  { version: '2.7.0', date: 'Aug 30', title: 'KV transactions', body: 'Atomic multi-key transactions are now generally available.' },
  { version: '2.6.1', date: 'Aug 14', title: 'Region pinning', body: 'Pin functions to a subset of regions for data residency.' },
  { version: '2.6.0', date: 'Aug 02', title: 'Cron triggers', body: 'Schedule functions with standard cron expressions.' },
  { version: '2.5.0', date: 'Jul 18', title: 'Custom domains', body: 'Bring your own domain with automatic TLS certificates.' },
];
