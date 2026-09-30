import { useState } from 'react';
import { Changelog } from './components/Changelog';
import { Features } from './components/Features';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { LogoCloud } from './components/LogoCloud';
import { Modal } from './components/Modal';
import { Navbar } from './components/Navbar';
import { Pricing } from './components/Pricing';
import { SignupForm } from './components/SignupForm';
import { Testimonials } from './components/Testimonials';

export default function App() {
  const [demoOpen, setDemoOpen] = useState(false);
  return (
    <>
      <Navbar />
      <main>
        <Hero onWatchDemo={() => setDemoOpen(true)} />
        <LogoCloud />
        <Features />
        <Pricing />
        <Changelog />
        <Testimonials />
        <SignupForm />
      </main>
      <Footer />
      <Modal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </>
  );
}
