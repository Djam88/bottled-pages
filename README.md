# Bottled Pages

A vintage reading tracker. Every book is a bottle at sea that fills with the pages you read; finish it, seal it with a letter, and it washes ashore.

- `site/` is what Netlify publishes (a single page, a service worker, a web app manifest and icons).
- `src/page.html` is the page source. Run `python3 build.py` to regenerate `site/` from it.

Books and notes are stored in the browser that uses the app (localStorage). Use Export / Import in the app to move a shelf between devices.
