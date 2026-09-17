/**
 * Fixture equivalente al rastreo de novemp.com.mx que produjo los falsos
 * positivos: 158 URLs solicitadas, de las cuales 54 son archivos dentro de
 * /wp-content/uploads/.
 *
 * Nada aquí es específico de ese dominio: es un sitio WordPress cualquiera
 * y la corrección debe funcionar igual en cualquier otro. El dominio sólo
 * sirve para poder comparar cifras con el informe anterior.
 */

export type FixtureResponse = {
  url: string;
  statusCode: number | null;
  contentType: string | null;
  errorType?: string | null;
  redirectChain?: string[];
  finalUrl?: string;
  /** Cuerpo HTML, sólo para los documentos. */
  html?: string;
};

const DOMAIN = 'https://novemp.com.mx';

/** Páginas HTML con metadatos completos: no deben generar incidencias. */
const GOOD_PAGES = 18;
/** Páginas HTML a las que de verdad les falta la meta description. */
const PAGES_WITHOUT_DESCRIPTION = 6;
/** Páginas HTML a las que de verdad les falta el H1. */
const PAGES_WITHOUT_H1 = 2;
/** Archivos dentro de /wp-content/uploads/ (los 54 del informe anterior). */
const UPLOADS = 54;

const IMAGE_TYPES: [string, string][] = [
  ['webp', 'image/webp'],
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['svg', 'image/svg+xml'],
];

function htmlDoc(options: {
  title?: string | null;
  description?: string | null;
  h1?: string | null;
  canonical?: string | null;
  images?: string;
  body?: string;
}): string {
  const head = [
    options.title === null ? '' : `<title>${options.title ?? 'Novemp · Página'}</title>`,
    options.description === null
      ? ''
      : `<meta name="description" content="${options.description ?? 'Descripción suficientemente larga para pasar la validación de longitud mínima del auditor.'}">`,
    options.canonical === null ? '' : `<link rel="canonical" href="${options.canonical ?? DOMAIN}/">`,
  ].join('');

  const h1 = options.h1 === null ? '' : `<h1>${options.h1 ?? 'Encabezado principal'}</h1>`;

  return `<!doctype html><html lang="es"><head>${head}</head><body>${h1}${options.images ?? ''}${options.body ?? '<p>Contenido.</p>'}</body></html>`;
}

/**
 * Galería responsive: una sola imagen con seis tamaños en `srcset`.
 * En el informe anterior esto inflaba la cuenta de "imágenes sin alt".
 */
const RESPONSIVE_GALLERY = `
  <picture>
    <source srcset="/wp-content/uploads/2024/10/plataforma.avif 1x, /wp-content/uploads/2024/10/plataforma@2x.avif 2x" type="image/avif">
    <source srcset="/wp-content/uploads/2024/10/plataforma.webp" type="image/webp">
    <img src="/wp-content/uploads/2024/10/plataforma.jpg"
         srcset="/wp-content/uploads/2024/10/plataforma-400.jpg 400w, /wp-content/uploads/2024/10/plataforma-800.jpg 800w, /wp-content/uploads/2024/10/plataforma-1600.jpg 1600w"
         alt="Panel de una plataforma LMS">
  </picture>
`;

/** Logo compartido por todas las páginas: caso 22 (mismo recurso, N páginas). */
const SHARED_LOGO = '<img src="/wp-content/uploads/2023/01/logo-novemp.webp">';

/** Separador decorativo correctamente declarado con alt="". */
const DECORATIVE = '<img src="/wp-content/uploads/2023/01/separador.webp" alt="">';

/** Fondo por CSS: no es un <img>, no tiene alt y no debe reportarse. */
const CSS_BACKGROUND =
  '<div class="hero" style="background-image:url(/wp-content/uploads/2024/01/hero.webp)">Hero</div>';

export function novempFixture(): FixtureResponse[] {
  const responses: FixtureResponse[] = [];

  // ---- Home
  responses.push({
    url: `${DOMAIN}/`,
    statusCode: 200,
    contentType: 'text/html; charset=UTF-8',
    html: htmlDoc({
      title: 'Novemp · Plataformas de aprendizaje',
      canonical: `${DOMAIN}/`,
      images: SHARED_LOGO + RESPONSIVE_GALLERY + DECORATIVE + CSS_BACKGROUND,
    }),
  });

  // ---- Páginas correctas
  for (let i = 0; i < GOOD_PAGES; i++) {
    responses.push({
      url: `${DOMAIN}/servicios/pagina-${i}`,
      statusCode: 200,
      contentType: 'text/html; charset=UTF-8',
      html: htmlDoc({
        title: `Servicio ${i} · Novemp consultoría`,
        canonical: `${DOMAIN}/servicios/pagina-${i}`,
        images: SHARED_LOGO + DECORATIVE,
      }),
    });
  }

  // ---- Páginas con errores on-page REALES, que deben seguir apareciendo
  for (let i = 0; i < PAGES_WITHOUT_DESCRIPTION; i++) {
    responses.push({
      url: `${DOMAIN}/blog/entrada-${i}`,
      statusCode: 200,
      contentType: 'text/html; charset=UTF-8',
      html: htmlDoc({
        title: `Entrada de blog ${i} sobre formación digital`,
        description: null,
        canonical: `${DOMAIN}/blog/entrada-${i}`,
        // Una imagen sin alt por página: incidencias reales de alt.
        images: SHARED_LOGO + `<img src="/wp-content/uploads/2024/03/post-${i}.webp">`,
      }),
    });
  }

  for (let i = 0; i < PAGES_WITHOUT_H1; i++) {
    responses.push({
      url: `${DOMAIN}/legal/aviso-${i}`,
      statusCode: 200,
      contentType: 'text/html; charset=UTF-8',
      html: htmlDoc({
        title: `Aviso legal ${i} de Novemp servicios`,
        h1: null,
        canonical: `${DOMAIN}/legal/aviso-${i}`,
        images: SHARED_LOGO,
      }),
    });
  }

  // ---- 404 con plantilla HTML personalizada
  responses.push({
    url: `${DOMAIN}/pagina-borrada`,
    statusCode: 404,
    contentType: 'text/html; charset=UTF-8',
    html: htmlDoc({
      title: 'Error 404 · Página no encontrada',
      description: null,
      h1: 'No encontramos lo que buscabas',
      canonical: null,
      body: '<p>Vuelve al inicio.</p>',
    }),
  });

  // ---- Redirección que acaba en HTML
  responses.push({
    url: `${DOMAIN}/servicios-antiguos`,
    statusCode: 301,
    contentType: 'text/html; charset=UTF-8',
    finalUrl: `${DOMAIN}/servicios/pagina-0`,
    redirectChain: [`${DOMAIN}/servicios-antiguos`],
  });

  // ---- Redirección que acaba en una imagen
  responses.push({
    url: `${DOMAIN}/foto-destacada`,
    statusCode: 302,
    contentType: 'image/webp',
    finalUrl: `${DOMAIN}/wp-content/uploads/2024/10/plataforma.webp`,
    redirectChain: [`${DOMAIN}/foto-destacada`],
  });

  // ---- Los 54 archivos de /wp-content/uploads/
  // Entraron a la cola porque la galería de WordPress enlaza <a href> al
  // archivo original. Son recursos legítimos que se comprueban, pero no
  // son páginas.
  for (let i = 0; i < UPLOADS; i++) {
    const [ext, mime] = IMAGE_TYPES[i % IMAGE_TYPES.length];

    // Uno de ellos está roto: debe reportarse como recurso roto.
    if (i === 7) {
      responses.push({
        url: `${DOMAIN}/wp-content/uploads/2024/03/post-0.webp`,
        statusCode: 404,
        contentType: 'text/html; charset=UTF-8',
      });
      continue;
    }

    // Otro llega sin Content-Type: se clasifica por extensión.
    if (i === 11) {
      responses.push({
        url: `${DOMAIN}/wp-content/uploads/2023/05/ficha.webp`,
        statusCode: 200,
        contentType: null,
      });
      continue;
    }

    // Otro se sirve como octet-stream.
    if (i === 12) {
      responses.push({
        url: `${DOMAIN}/wp-content/uploads/2023/05/catalogo.pdf`,
        statusCode: 200,
        contentType: 'application/octet-stream',
      });
      continue;
    }

    // Otro tiene extensión .jpg pero se entrega como image/webp.
    if (i === 13) {
      responses.push({
        url: `${DOMAIN}/wp-content/uploads/2024/02/convertida.jpg`,
        statusCode: 200,
        contentType: 'image/webp',
      });
      continue;
    }

    responses.push({
      url: `${DOMAIN}/wp-content/uploads/2024/0${(i % 9) + 1}/archivo-${i}.${ext}`,
      statusCode: 200,
      contentType: mime,
    });
  }

  // ---- Assets de tema y plugins
  responses.push({
    url: `${DOMAIN}/wp-content/themes/novemp/style.css`,
    statusCode: 200,
    contentType: 'text/css',
  });
  responses.push({
    url: `${DOMAIN}/wp-includes/js/jquery.min.js`,
    statusCode: 200,
    contentType: 'application/javascript',
  });
  responses.push({
    url: `${DOMAIN}/wp-content/themes/novemp/fonts/inter.woff2`,
    statusCode: 200,
    contentType: 'font/woff2',
  });
  responses.push({
    url: `${DOMAIN}/wp-content/documentos/2023/09/dossier.pdf`,
    statusCode: 200,
    contentType: 'application/pdf',
  });

  // Relleno hasta las 158 URLs del informe anterior, con páginas correctas.
  let filler = 0;
  while (responses.length < 158) {
    responses.push({
      url: `${DOMAIN}/recursos/articulo-${filler}`,
      statusCode: 200,
      contentType: 'text/html; charset=UTF-8',
      html: htmlDoc({
        title: `Artículo de recursos ${filler} para equipos`,
        canonical: `${DOMAIN}/recursos/articulo-${filler}`,
        images: SHARED_LOGO,
      }),
    });
    filler++;
  }

  return responses;
}

export const FIXTURE_CONSTANTS = {
  DOMAIN,
  TOTAL_URLS: 158,
  UPLOADS,
  PAGES_WITHOUT_DESCRIPTION,
  PAGES_WITHOUT_H1,
};
