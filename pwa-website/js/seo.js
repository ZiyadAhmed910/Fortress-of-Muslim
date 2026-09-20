import { els } from './dom.js';

// One place that knows what the page currently is, because two audiences need to be told and they
// read different things. A person reads the heading; a crawler, a browser tab, a bookmark and a
// shared link all read <title> and the meta description.
//
// Before this, the heading changed on every navigation and <title> never did: every URL on the site
// was "Fortress of Muslim" with the same description, which is the shape of a site with one page.
// Al-Baqarah and the qibla compass were indistinguishable to anything that was not running the app.
//
// This app renders on the client, so none of it is in the HTML a crawler is first served. Search
// engines that execute JavaScript will see these values; the rest see the defaults in index.html.
// That is a real limit and the reason the titles below are written to be useful either way.
const SITE = 'Fortress of Muslim';
const DEFAULT_DESCRIPTION = els.app
  ? document.querySelector('meta[name="description"]')?.content ?? ''
  : '';

const descriptionTag = () => document.querySelector('meta[name="description"]');

/**
 * Sets the on-screen heading and, with it, the document title and description.
 *
 * `subtitle` does double duty deliberately: on screen it is the line under the heading, and in the
 * title it is what distinguishes one page from another in a list of browser tabs. Where it is a
 * position rather than a description ("3 of 7"), pass `{ inTitle: false }` -- a tab reading
 * "3 of 7 - Fortress of Muslim" tells the reader nothing they wanted to know.
 */
export function setScreen(title, subtitle, { inTitle = true } = {}) {
  if (els.screenTitle) els.screenTitle.textContent = title;
  if (els.screenSubtitle) els.screenSubtitle.textContent = subtitle;

  document.title = title === SITE || !title ? siteTitle() : `${title} - ${SITE}`;
  const description = inTitle && subtitle ? `${subtitle}. ${DEFAULT_DESCRIPTION}` : DEFAULT_DESCRIPTION;
  const tag = descriptionTag();
  if (tag) tag.content = description.slice(0, 300);
}

/** The homepage title: the name plus what the thing actually is, for anyone who has not heard of it. */
const siteTitle = () => `${SITE} - Duas, Quran, Hadith, Prayer Times`;

/**
 * Points the canonical link at the URL actually being read.
 *
 * Every route on this site is served the same HTML by a catch-all rewrite, so without this every
 * page claims to be the homepage and a search engine is being told, correctly, that they are all
 * duplicates of one another.
 */
export function setCanonical(pathname = location.pathname) {
  const link = document.querySelector('link[rel="canonical"]');
  if (!link) return;
  const path = pathname.replace(/\/+$/, '');
  link.href = `https://fortressofmuslim.org${path || '/'}`;
}
