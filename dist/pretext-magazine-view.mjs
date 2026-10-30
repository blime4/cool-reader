function createElement(documentRef, tag, className, text = '') {
  const node = documentRef.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function guideForPart(guide, text, failedImages) {
  return Boolean(guide?.name && guide?.imageUrl && text.includes(guide.name) && !failedImages.has(guide.imageUrl));
}

function renderLine(documentRef, line, offset) {
  const node = createElement(documentRef, 'span', 'magazine-line', line.text);
  node.dataset.sourceStart = String(offset + line.sourceStart);
  node.dataset.sourceEnd = String(offset + line.sourceEnd);
  node.style.position = 'absolute';
  node.style.left = `${line.x}px`;
  node.style.top = `${line.y}px`;
  if (line.availableWidth) node.style.width = `${line.availableWidth}px`;
  return node;
}

function renderFigure({documentRef, figure, sourceGuide, revision, currentRevision, onFigure, onFailure}) {
  const role = figure.role === 'feature' ? 'feature' : 'inset';
  const card = createElement(documentRef, 'button', `magazine-figure magazine-figure-${role}`);
  card.setAttribute('type', 'button');
  card.setAttribute('aria-label', `查看${figure.name}的详细资料`);
  card.style.position = 'absolute';
  card.style.left = `${figure.x}px`;
  card.style.top = `${figure.y}px`;
  card.style.width = `${figure.width}px`;
  card.style.height = `${figure.height}px`;
  card.addEventListener('click', () => onFigure(sourceGuide));

  const image = createElement(documentRef, 'img', 'magazine-figure-image');
  image.src = figure.imageUrl;
  image.alt = figure.name;
  image.addEventListener('error', () => {
    if (revision === currentRevision()) onFailure(figure.imageUrl);
  });

  const caption = createElement(documentRef, 'span', 'magazine-figure-caption');
  if (role === 'feature') caption.append(createElement(documentRef, 'small', 'magazine-figure-kicker', '自然图鉴 / FIELD NOTE'));
  caption.append(createElement(documentRef, 'strong', 'magazine-figure-name', figure.name));
  if (figure.scientificName) caption.append(createElement(documentRef, 'em', 'magazine-figure-scientific', figure.scientificName));
  const kind = figure.imageKind === 'generated' ? 'AI 示意图' : figure.imageKind === 'photo' ? '实拍资料' : '参考资料';
  caption.append(createElement(documentRef, 'small', 'magazine-figure-kind', kind));
  card.append(image, caption);
  return card;
}

export function createPretextMagazineView({leaves, layouter, documentRef = document, onFigure = () => {}}) {
  let revision = 0;
  let latest = null;
  const failedImages = new Set();

  function render(input) {
    revision += 1;
    const renderRevision = revision;
    latest = input;
    let supported = true;

    const figureBuckets = input.parts.map(()=>[]);
    for (const guide of input.guides) {
      const partIndex = input.parts.findIndex(part=>guideForPart(guide,part.text,failedImages));
      if (partIndex >= 0) figureBuckets[partIndex].push(guide);
    }
    input.parts.forEach((part, index) => {
      const leaf = leaves[index];
      const figures = figureBuckets[index];
      const result = layouter.layout({
        ...input.options,
        text: part.text,
        side: index === 0 ? 'left' : 'right',
        figures,
      });

      if (!result.supported) {
        supported = false;
        leaf.textContent = result.fallbackText ?? part.text;
        return;
      }

      const root = createElement(documentRef, 'div', 'magazine-leaf');
      root.style.position = 'relative';
      root.setAttribute('role', 'document');
      root.append(...result.lines.map(line => renderLine(documentRef, line, part.offset)));
      root.append(...result.figures.map(figure => renderFigure({
        documentRef,
        figure,
        sourceGuide: figures.find(guide => guide.imageUrl === figure.imageUrl && guide.name === figure.name) ?? figure,
        revision: renderRevision,
        currentRevision: () => revision,
        onFigure,
        onFailure(imageUrl) {
          failedImages.add(imageUrl);
          if (latest === input) render(input);
        },
      })));
      leaf.replaceChildren(root);
    });

    return {supported};
  }

  return {render};
}
