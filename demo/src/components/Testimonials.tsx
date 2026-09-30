import { testimonials } from '../data/content';

export function Testimonials() {
  return (
    <section className="section">
      <div className="container">
        <h2 className="section-title text-center">Loved by developers</h2>
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <figure key={t.name} className="rounded-xl border border-white/10 bg-white/5 p-6">
              <blockquote className="text-base leading-relaxed text-slate-200">“{t.quote}”</blockquote>
              <figcaption className="mt-4 text-sm">
                <div className="font-semibold text-white">{t.name}</div>
                <div className="text-slate-400">{t.role}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
