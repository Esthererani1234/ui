export const saleFacts={
  AZ:{ordinary_coin_sale:'Coin sold intact',jewelry_or_art_manufacture:'Coin sold to manufacture jewelry or art',
    metal_pricing:'Refined bar valued for its metal content',form_pricing:'Bar valued for its form'},
  ID:{ordinary_coin_sale:'Coin sold intact for ordinary retail use',jewelry_or_art_manufacture:'Coin sold to manufacture jewelry or art'},
  AL:{metal_pricing:'Price determined by the metal',numismatic_pricing:'Price determined by collectible characteristics'},
  CT:{metal_pricing:'Traded for its precious-metal value',rare_or_antique:'Documented rare or antique coin',ordinary_collectible:'Neither rare nor antique, priced as a collectible'},
  OK:{metal_pricing:'Sold for precious-metal value',investment_sale:'Sold or purchased as an investment',noninvestment_collectible:'Collectible sale without an investment or metal-value basis'},
  NJ:{metal_pricing:'Investment bullion valued for its metal content',numismatic_pricing:'Numismatic coin with documented individual market value'},
};
const bars={sovereign_use_metal_price:'Documented qualifying government use and metal-content price',
  sovereign_use_collectible_price:'Documented qualifying government use and intrinsic collectible price',
  no_qualifying_sovereign_use:'Evidence rules out qualifying government use',form_pricing:'Price determined by form or representative value'};
for(const state of ['AR','KY','MS'])saleFacts[state]=bars;
