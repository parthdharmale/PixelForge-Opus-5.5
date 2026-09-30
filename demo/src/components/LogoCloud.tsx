import { logos } from '../data/content';

export function LogoCloud() {
  return (
    <section className="border-y border-white/10 py-10">
      <div className="container">
        <p className="text-center text-sm text-slate-400">Trusted by engineering teams at</p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
          {logos.map((logo) => (
            <li key={logo} className="text-xl font-semibold tracking-tight text-slate-500">
              {logo}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
