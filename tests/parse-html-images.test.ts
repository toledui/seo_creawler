import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHtml } from '../src/crawler/parse-html';
import { parseSrcset, srcsetUrls } from '../src/crawler/srcset';

const BASE = 'https://ejemplo.com/servicios/';

function page(body: string): string {
  return `<!doctype html><html lang="es"><head><title>Servicios</title></head><body>${body}</body></html>`;
}

describe('atributo alt: ausente, vacío y descriptivo son tres estados', () => {
  it('18. <img> sin atributo alt se marca como ausente', () => {
    const { images } = parseHtml(page('<img src="imagen.webp">'), BASE);
    assert.equal(images.length, 1);
    assert.equal(images[0].hasAlt, false);
    assert.equal(images[0].alt, null);
    assert.equal(images[0].src, 'https://ejemplo.com/servicios/imagen.webp');
  });

  it('19. alt="" es una imagen decorativa válida, no un alt ausente', () => {
    const { images } = parseHtml(page('<img src="decoracion.webp" alt="">'), BASE);
    assert.equal(images[0].hasAlt, true);
    assert.equal(images[0].alt, '');
  });

  it('19b. alt="   " se considera declarado pero vacío (decorativo)', () => {
    const { images } = parseHtml(page('<img src="d.webp" alt="   ">'), BASE);
    assert.equal(images[0].hasAlt, true);
    assert.equal((images[0].alt ?? '').trim(), '');
  });

  it('20. alt descriptivo se conserva íntegro', () => {
    const { images } = parseHtml(
      page('<img src="plataforma-lms.webp" alt="Panel de una plataforma LMS">'),
      BASE,
    );
    assert.equal(images[0].hasAlt, true);
    assert.equal(images[0].alt, 'Panel de una plataforma LMS');
  });

  it('los tres estados conviven sin mezclarse en la misma página', () => {
    const { images } = parseHtml(
      page(`
        <img src="a.webp">
        <img src="b.webp" alt="">
        <img src="c.webp" alt="Una foto descriptiva">
      `),
      BASE,
    );
    const missing = images.filter((i) => !i.hasAlt);
    const decorative = images.filter((i) => i.hasAlt && !(i.alt ?? '').trim());
    const described = images.filter((i) => (i.alt ?? '').trim().length > 0);

    assert.equal(images.length, 3);
    assert.equal(missing.length, 1);
    assert.equal(decorative.length, 1);
    assert.equal(described.length, 1);
  });
});

describe('srcset y <picture>', () => {
  it('parseSrcset respeta las comas dentro de la URL', () => {
    const parsed = parseSrcset(
      '/cdn-cgi/image/w=400,q=75/foto.webp 400w, /cdn-cgi/image/w=800,q=75/foto.webp 800w',
    );
    assert.deepEqual(
      parsed.map((c) => c.url),
      ['/cdn-cgi/image/w=400,q=75/foto.webp', '/cdn-cgi/image/w=800,q=75/foto.webp'],
    );
    assert.deepEqual(
      parsed.map((c) => c.descriptor),
      ['400w', '800w'],
    );
  });

  it('parseSrcset acepta candidatos sin descriptor', () => {
    assert.deepEqual(srcsetUrls('a.webp, b.webp 2x'), ['a.webp', 'b.webp']);
    assert.deepEqual(srcsetUrls(null), []);
  });

  it('21. srcset con varias versiones cuenta como UNA imagen', () => {
    const { images } = parseHtml(
      page(`
        <img src="foto-800.webp"
             srcset="foto-400.webp 400w, foto-800.webp 800w, foto-1600.webp 1600w"
             alt="Foto responsive">
      `),
      BASE,
    );
    assert.equal(images.length, 1, 'seis tamaños no son seis imágenes sin alt');
    assert.equal(images[0].hasAlt, true);
    assert.equal(images[0].candidates.length, 3);
    assert.ok(images[0].candidates.includes('https://ejemplo.com/servicios/foto-1600.webp'));
  });

  it('21b. <picture> con <source> agrupa todas las variantes en un solo elemento', () => {
    const { images } = parseHtml(
      page(`
        <picture>
          <source srcset="foto.avif 1x, foto@2x.avif 2x" type="image/avif">
          <source srcset="foto.webp" type="image/webp">
          <img src="foto.jpg" alt="Foto con art direction">
        </picture>
      `),
      BASE,
    );
    assert.equal(images.length, 1);
    assert.equal(images[0].alt, 'Foto con art direction');
    assert.ok(images[0].candidates.includes('https://ejemplo.com/servicios/foto.avif'));
    assert.ok(images[0].candidates.includes('https://ejemplo.com/servicios/foto.webp'));
    assert.ok(images[0].candidates.includes('https://ejemplo.com/servicios/foto.jpg'));
  });

  it('un <img> con sólo srcset (lazy loading) no se pierde', () => {
    const { images } = parseHtml(
      page('<img data-src="lazy.webp" data-srcset="lazy-2x.webp 2x">'),
      BASE,
    );
    assert.equal(images.length, 1);
    assert.equal(images[0].src, 'https://ejemplo.com/servicios/lazy.webp');
    assert.equal(images[0].hasAlt, false);
  });
});

describe('resolución de URLs de imagen', () => {
  it('las URLs relativas se resuelven contra la página', () => {
    const { images } = parseHtml(
      page('<img src="../uploads/foto.webp" alt="x"><img src="/abs/foto2.png" alt="y">'),
      BASE,
    );
    assert.equal(images[0].src, 'https://ejemplo.com/uploads/foto.webp');
    assert.equal(images[1].src, 'https://ejemplo.com/abs/foto2.png');
  });

  it('las imágenes de un CDN externo se conservan tal cual', () => {
    const { images } = parseHtml(
      page('<img src="https://cdn.otrodominio.com/x/foto.webp" alt="cdn">'),
      BASE,
    );
    assert.equal(images[0].src, 'https://cdn.otrodominio.com/x/foto.webp');
  });

  it('los parámetros de transformación se preservan', () => {
    const { images } = parseHtml(page('<img src="foto.jpg?w=800&q=75" alt="q">'), BASE);
    assert.equal(images[0].src, 'https://ejemplo.com/servicios/foto.jpg?w=800&q=75');
  });

  it('una imagen de fondo CSS no genera ningún <img> y por tanto ningún alt', () => {
    const { images } = parseHtml(
      page('<div style="background-image:url(fondo.webp)">Hola</div>'),
      BASE,
    );
    assert.equal(images.length, 0);
  });
});
