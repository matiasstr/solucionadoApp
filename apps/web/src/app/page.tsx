import { Brand, Surface } from '@tusofertas/ui';
import Link from 'next/link';
import { HeaderAuthLinks } from '../components/auth/header-auth-links';
import { SearchForm } from '../components/search/search-form';

const steps = [
  { number: '01', title: 'Contanos qué comprás', text: 'Tus productos de siempre, las cantidades y lo que ya tenés en casa.' },
  { number: '02', title: 'Encontrá mejores precios', text: 'Compará el mismo producto y sus alternativas, con el precio por kilo o litro a la vista. Ya podés probarlo con datos de demostración.' },
  { number: '03', title: 'Organizá tu semana', text: 'Un plan que tenga en cuenta el ahorro, la distancia y cuántas tiendas querés visitar.' },
];

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#contenido">Ir al contenido</a>
      <div className="announcement">Hecho para tus compras de todos los días <span aria-hidden="true">·</span> Argentina</div>
      <header className="site-header mx-auto flex max-w-6xl items-center justify-between px-6">
        <Link href="/" className="brand-link"><Brand /></Link>
        <HeaderAuthLinks />
      </header>
      <main id="contenido">
        <section className="hero mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
          <div>
            <p className="eyebrow"><span className="status-dot" /> MENOS GASTO, MÁS PLAN</p>
            <h1>¿Cuánto podés<br />ahorrar <span>esta semana?</span></h1>
            <p className="hero-copy">Tus compras de siempre pueden costar menos. Compará el mismo producto entre sucursales, con el precio por kilo o litro a la vista.</p>
            <SearchForm />
            <div className="hero-actions">
              <Link className="text-link" href="/buscar">Ver cómo se compara un producto</Link>
              <a className="text-link" href="#como-funciona">Conocé la propuesta</a>
            </div>
            <p className="launch-note">Comparar no requiere cuenta. Los precios que vas a ver son <strong>de demostración</strong>: sirven para probar la app, no son ofertas reales.</p>
          </div>
          <div className="preview-area">
            <div className="preview-decoration" aria-hidden="true" />
            <Surface className="shopping-preview">
              <div className="preview-heading"><Brand compact /><span>TU COMPRA, MÁS CLARA</span></div>
              <h2>Lo de siempre.<br /><span>Mejor organizado.</span></h2>
              <p className="preview-label">Ejemplo de una lista habitual</p>
              <ul className="grocery-list">
                <li><span className="grocery-icon" aria-hidden="true">◒</span><span><strong>Leche</strong><small>Para los desayunos</small></span><span className="grocery-quantity">6 litros</span></li>
                <li><span className="grocery-icon" aria-hidden="true">❋</span><span><strong>Yerba</strong><small>El mate no se negocia</small></span><span className="grocery-quantity">1 kg</span></li>
                <li><span className="grocery-icon" aria-hidden="true">≋</span><span><strong>Arroz</strong><small>Un básico en la despensa</small></span><span className="grocery-quantity">2 kg</span></li>
              </ul>
              <div className="preview-footer"><span aria-hidden="true">↘</span><p>El mejor precio también tiene<br />que quedar a mano.</p></div>
            </Surface>
            <div className="floating-note"><span aria-hidden="true">✓</span> Tu tiempo también vale.</div>
          </div>
        </section>
        <section id="como-funciona" className="how-section">
          <div className="mx-auto max-w-6xl px-6">
            <div className="section-heading"><p className="eyebrow">ASÍ LO ESTAMOS PENSANDO</p><h2>Una compra inteligente<br />empieza con tus hábitos.</h2></div>
            <div className="grid gap-5 md:grid-cols-3">
              {steps.map((step) => <Surface className="step-card" key={step.number}><span className="step-number">{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></Surface>)}
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer mx-auto flex max-w-6xl flex-col justify-between gap-3 px-6 sm:flex-row"><Brand /><p>Compras mejor pensadas, para todos los días.</p></footer>
    </>
  );
}
