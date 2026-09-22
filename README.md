# @absolutejs/stock-images

Provider-neutral stock photo search, selection, attribution and typed failure contracts.

Server-side only: keep provider keys out of browser bundles and generated projects.
Search results retain provider descriptions, original image URLs, dimensions, attribution and license links. Metadata is not visual proof of what an image depicts; review the actual image before claiming specific equipment, people or services.

Call `select(id)` only when actually inserting an image. Unsplash records its required download notification before selection succeeds. Do not repeatedly call selection during render, search or hover. A failed notification means insertion must not proceed. The caller owns duplicate-click prevention and durable insertion records.

Search returns pagination per provider. Failures remain distinguishable from empty results. Keys and upstream error bodies are never included in error messages. Requests time out and reject redirects. Cancellation is supported.

Preserve the returned attribution and hotlink requirements wherever images are used; a stock license is not proof of model/property releases or permission for all contexts.

Provider documentation: [Unsplash](https://unsplash.com/documentation), [Pexels](https://www.pexels.com/api/documentation/).

Live credentials are not included. Automated tests use synthetic API-shaped responses, not live-provider acceptance.
