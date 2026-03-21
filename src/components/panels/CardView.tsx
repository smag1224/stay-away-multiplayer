import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { ShowCardTextCtx } from './ShowCardTextCtx.ts';
import { getCardDef, getCardImage } from '../../cards.ts';
import { cardCategoryLabel, type Lang } from '../../appHelpers.ts';
import type { CardInstance } from '../../types.ts';

export function CardView({ card, faceUp }: { card: CardInstance; faceUp: boolean }) {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ru';
  const showText = useContext(ShowCardTextCtx);
  const def = getCardDef(card.defId);
  if (!faceUp) {
    return <div className={`card card-back ${def.back === 'panic' ? 'panic-back' : 'event-back'}`} />;
  }

  const imgSrc = getCardImage(card.defId);

  return (
    <div className={`card cat-${def.category} ${imgSrc ? 'has-image' : ''} ${showText ? 'show-text' : ''}`}>
      {imgSrc && <img alt="" className="card-bg-img" src={imgSrc} />}
      <div className="card-overlay">
        <div className={`card-badge badge-${def.category}`}>{cardCategoryLabel(card, lang)}</div>
        {showText && (
          <>
            <div className="card-name">{lang === 'ru' ? def.nameRu : def.name}</div>
            <div className="card-desc">{lang === 'ru' ? def.descriptionRu : def.description}</div>
          </>
        )}
      </div>
    </div>
  );
}
