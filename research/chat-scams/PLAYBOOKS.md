# Chat-scam playbooks for detection

Defensive notes for a later on-device classifier. They describe **what a conversation looks like to a detector**: the publicly documented stages, phrases, and red flags. They are not instructions for contacting anyone, moving money, or getting around a bank or platform.

Sources were read on **4 November 2026**. Quotations are short extracts from those pages. Nothing here is a guessed statistic or a made-up citation. Where a paper describes a finer lifecycle than the tags below, the paper’s own wording is kept and the tags are only a labeling scheme for `data/chat-scams/seed.jsonl`.

## Labeling stages

Seed messages use one stage each:

| Stage | What it is in a scam chat | What it is not |
|---|---|---|
| `hook` | First contact that creates a reason to reply: a wrong number, a “new phone”, a listing, a job ad, a bank alert | A normal greeting between people who already share context |
| `trust` | Details that make the sender feel known: a relationship, a shared errand, a screenshot, a small early “win” | Confirming plans you both already made |
| `urgency` | A reason you must act before you can check: a bill due now, a buyer leaving town, an account about to be emptied | A real deadline you can verify on a channel you already trust |
| `payment_ask` | A request to send money, a code, a PIN, or a credential, often to a name or rail you did not choose | Paying someone you are with, on the listing’s own checkout, or to an account you already use |
| `move_off_platform` | Push to leave the marketplace, dating app, or SMS thread for WhatsApp, Telegram, or a private number | Swapping a pickup photo while payment stays on the protected checkout |
| `recovery` | A later contact offering to get the money back for a fee, often posing as police, a lawyer, or the bank | Your own bank, called on the number printed on the card |

Benign turns are tagged `benign`. The other person’s replies in a scam are tagged `reply`. Real chats skip and reorder stages. Oak and Shafiq describe pig-butchering as **seven stages plus a possible encore**, not as these six tags. Their abstract names the tactics they actually analyzed: staged trust-building, fraudulent financial platforms, fabricated returns, repeated pressure, and re-engagement that increases the loss ([Oak and Shafiq, arXiv:2503.20821](https://arxiv.org/abs/2503.20821), accepted to USENIX SOUPS 2025).

Adnan, Manjunath, and Khare describe pig-butchering, in the body of their paper, as **hook, line, and sinker**, often opening as a wrong-number text or a professional-network request ([arXiv:2607.11707](https://arxiv.org/abs/2607.11707)). PreScam treats progression itself as the task: from 177,989 user-submitted reports they built 11,573 conversational instances in 20 categories, and found that supervised encoders beat zero-shot language models at predicting whether a conversation is nearing its end ([Sun et al., arXiv:2605.12243](https://arxiv.org/abs/2605.12243)). That benchmark’s download terms were not verified for this note, so it is not in `datasets.md` as a corpus to train on.

## Signals that recur across types

These are the features worth encoding. Each one is a **public warning sign**, not a sufficient condition. Hard benign chats in the seed mention money, MobilePay, PayPal, gift cards, or WhatsApp without being scams.

- **New or unknown channel for someone you know.** “Hi mum” messages claim a lost, broken, or replaced phone and a new number. MobilePay, Danish police, Forbrugerrådet Tænk, and the ACCC all describe that opening. Check on the number you already had, not inside the new thread.
- **Vague answers and a refusal to talk.** Tænk reports excuses such as a microphone that does not work, a SIM card “being installed”, or no time to talk, and vague replies such as “your eldest” when asked which child is writing.
- **The payee is not the person in the story.** MobilePay says the app shows the real name of the recipient, and that a child’s request should be treated with suspicion when that name is someone else. Their Snapchat warning says the other name is often a money mule.
- **Haste before a check.** MobilePay, Sydøstjyllands Politi, and Tænk all say the pressure is there so the recipient does not call back on a known number.
- **Irreversible rails.** FTC: nobody legitimate asks a romance contact to pay by cryptocurrency, gift-card numbers, or a wire. Gift cards are for gifts; anyone who demands one as payment is a scammer, in the FTC’s wording. Europol’s #CyberScams leaflet: a bank does not ask for a card PIN or an online-banking password, and does not ask you to move money to another account.
- **Off-platform plus pay-first.** FTC romance reports describe a fast move from the dating app or social network to WhatsApp, Google Chat, or Telegram. On Danish marketplaces, Tænk’s advice to sellers is the mirror image: do not accept a story that a friend of the buyer will pay, or that the money will arrive later. Wait until the money is actually in the account.
- **Too-good returns and a fake balance.** Europol’s crypto-scam infographic and the FTC’s 2026 social-media spotlight describe guaranteed or extraordinary profit, a polished platform, a small early withdrawal that builds trust, then a balance that cannot be taken out.
- **A second crime after the first.** Europol’s IOCTA 2023: after an investment fraud, offenders contact victims again posing as lawyers or law enforcement who can recover the funds for a fee. Tænk describes a paired version: a fake MobilePay text, then a call from someone pretending to be the bank who will “fix” it if you hand over details.

## 1. Family impersonation (“hi mum” / “hej mor”)

**Channels.** SMS, WhatsApp, Messenger, Snapchat. MobilePay says the message can also come from the real child’s account after it has been taken over. ACCC: most often WhatsApp.

**What public warnings say happens.**

1. Hook. An unknown number, or a taken-over profile, claims to be a child, parent, or friend. MobilePay quotes a typical opening: “Hej Mor, jeg har lige mistet min telefon og kan ikke betale en regning. Kan du hjælpe mig?” Sydøstjyllands Politi gives another full example: the phone has broken, this is a new number, please transfer 6,000 kroner for the new phone. ACCC: the sender has lost or damaged the phone and is on a new number; some messages only say “it’s me”.
2. Trust. Tænk: the chat often starts softer (“how are you, mum?”, “save this number”) and only later asks for money. If challenged, answers stay vague, or the sender cannot take a normal call.
3. Urgency and payment. A bill, a debt, or a new phone must be paid now, by netbank or MobilePay, sometimes to a friend or a marketplace seller rather than to the relative. Police in Sydøstjylland say the messages often start “Hej mor” or “Hej far” and later ask for a transfer. MobilePay says losses reported to the National Special Crime Unit (NCIK) in its 2024 report have reached as high as 100,000 kroner because a successful first payment is followed by more requests. They also say police received 3,869 reports of this scam in 2024, up 637 percent on the year before.

**Friend variant, same payment move.** Tænk: a friend on Messenger or Snapchat says their MobilePay is broken and asks you to pay a DBA or Facebook Marketplace purchase for them. MobilePay’s Snapchat note: the story is urgent, MobilePay “does not work today”, and the money should go to someone else’s MobilePay.

**Red flags for a model.** New number; lost or broken phone; “save this number”; cannot call; vague kinship; payee name differs from the person being impersonated; haste; a second and third amount after the first transfer.

**Hard benign lookalikes.** A relative you are already talking to asks you to MobilePay a shared cost to the same name as last time, and is happy to wait until you meet. Urgency alone (“the parking app expires in ten minutes”) is not enough when the person, the amount, and the in-person settlement all fit an ongoing arrangement.

**Sources.**

- MobilePay, [Hej Mor-svindel boomer](https://mobilepay.dk/news/hej-mor-svindel-boomer) and [Hackede Snapchat-konti misbruges til snyd](https://mobilepay.dk/news/hackede-snapchat-konti-misbruges-til-snyd). Payment-app warnings, not a bank, but they are the operator of the rail Danes are asked to use.
- Sydøstjyllands Politi, 8 August 2024, [Bedrageri: Sydøstjyllands Politi advarer mod "falske børn"](https://politi.dk/sydoestjyllands-politi/nyhedsliste/bedrageri-sydoestjyllands-politi-advarer-mod-falske-boern/2024/08/08).
- Forbrugerrådet Tænk, [“Hej mor”-svindel: Sådan spotter du falske beskeder fra bekendte](https://taenk.dk/forbrugerliv/elektronik-og-digitale-tjenester/hej-mor-svindel-saadan-genkender-du-falske-beskeder).
- ACCC, [warning on “Hi Mum” scams](https://www.accc.gov.au/media-release/accc-warning-of-suspicious-messages-as-hi-mum-scams-spike). Australian Consumer and Competition Commission. The release describes more than 1,150 reports and 2.6 million Australian dollars in losses in the first seven months of that year, concentrated in June and July 2022.

## 2. Marketplace: fake seller

**Channels.** Facebook Marketplace, DBA, and other classifieds, then Messenger, WhatsApp, or MobilePay.

**What public warnings support.**

- The goods are never sent, or never existed. Tænk groups “fupbutikker” (fake shops) and fraud when trading with private sellers on Facebook Marketplace as separate, common types. The FTC’s 2023 social-media spotlight found undelivered merchandise in 61 percent of loss reports about online shopping fraud that started on social media, in the first half of 2023; Facebook and Instagram dominated those reports ([Fletcher, FTC, October 2023](https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2023/10/social-media-golden-goose-scammers)).
- Payment is a private transfer. Forbrugerrådet Tænk’s MobilePay guide says a person-to-person MobilePay transfer is an account transfer: if you are cheated, there is often little you can do to get the money back. You are told to report it to the police and also to contact MobilePay, who cannot refund you but may have information for the police. A card payment through MobilePay is a different rail: the activity view shows the last four digits of the card, and Tænk tells you to contact your bank. If the activity only shows the card’s name or an account number, it was an account transfer.
- Danish police list “svindel med køb/salg af varer på internettet”, including buying, selling, or swapping a good or service that never arrived, under online fraud, and ask victims to upload bank statements, payment receipts, or correspondence with the perpetrator ([politi.dk](https://politi.dk/anmeld-kriminalitet/digital-kriminalitet/anmeld-oekonomisk-svindel-paa-nettet-og-digital-kriminalitet)). That page is a reporting form, not a script of the chat. It does show that message threads with the seller are evidence the police expect to see.

**Stages a detector should expect.** Hook inside the listing chat. Trust: extra photos, a story about why they cannot meet. Move off platform: continue on WhatsApp. Urgency: other buyers, the item will be gone today. Payment ask: a deposit or the full price before you have seen the item, on MobilePay, a bank transfer, or PayPal outside the listing.

The phrase “PayPal Friends & Family” is a known marketplace pattern in consumer reporting, but **this pass did not find an FTC or Danish-police page that uses that exact phrase**, so it is not quoted here as their wording. The seed still includes a synthetic Friends & Family ask because it is the off-platform private payment the FTC’s seller advice is about (do not take an informal mobile payment from a stranger; use a method you can dispute). See the fake-buyer section for the FTC page.

**Red flags.** Pay before viewing or before the platform checkout; switch to WhatsApp or Telegram for the payment itself; pressure from competing buyers; refusal to meet in a public place; private MobilePay or bank transfer for an online delivery.

**Hard benign lookalikes.** “Collect it tonight and MobilePay me when you are holding it.” “Send the pickup photo on WhatsApp, but pay through the listing.” A seller who refuses a private transfer is a negative example, not a scam.

**Sources.** Tænk, [Forstå 4 typer af digital svindel](https://taenk.dk/forbrugerliv/elektronik-og-digitale-tjenester/typer-digital-svindel) and [Dét skal du vide om MobilePay](https://taenk.dk/privatoekonomi/gode-raad/mobilepay). FTC social-media spotlight, October 2023, link above. Politi.dk reporting page, link above.

## 3. Marketplace: fake buyer

**Channels.** The same listing chats, plus SMS once a number is shared.

**What public warnings say.**

- Tænk, same “four types” article, quoting Ulla Malling on selling: do not accept explanations that you will be paid later, or that a friend of the buyer will pay. See that the money has actually arrived.
- FTC, [Selling stuff online? Here’s how to avoid a scam](https://consumer.ftc.gov/consumer-alerts/2022/07/selling-stuff-online-heres-how-avoid-scam) (July 2022), describes the fake-check overpayment: you are selling for 200 dollars, a buyer sends a check for 500, you deposit it, return 300, and ship the item. Weeks later the bank removes the 500. The page’s avoidance list: do not accept a mobile payment from someone you do not know, never deposit a check for more than the selling price, do not share a Google Voice or any other verification code.
- FTC, [Fake check scam targets online car sellers](https://consumer.ftc.gov/consumer-alerts/2025/02/fake-check-scam-targets-online-car-sellers) (February 2025): never send money to anyone who says they overpaid you by check, and never use money from a check to buy gift cards, money orders, or cryptocurrency.

**Stages.** Hook: eager buyer, often cannot collect in person. Trust: a screenshot or a tracking story. Payment ask: overpayment, a third party pays, or “the transfer is pending, ship now”. Urgency: they are leaving town, the courier is waiting. A verification-code ask is a second payment-shaped stage: the code is the thing of value.

**Red flags.** Check or transfer above the price; refund the difference by gift card, wire, or crypto; ship against a screenshot; “my friend will pay”; any one-time code sent back to the buyer.

**Hard benign lookalikes.** A buyer who will pay on the platform after collecting, or who asks ordinary questions about size and delivery and then stops.

## 4. Romance, then a payment

**Channels.** Dating apps, Instagram, Facebook, then WhatsApp, Google Chat, or Telegram. SMS when a number is exchanged.

**What the FTC says.** [What To Know About Romance Scams](https://consumer.ftc.gov/articles/what-know-about-romance-scams): the person cannot meet, often because they are abroad, on an oil rig, in the military, or with an international organization. After trust is built, sometimes with several chats a day, they ask you to pay medical bills, a plane ticket, a visa, or to get them out of trouble. They may also offer to teach you cryptocurrency. They choose rails that are hard to reverse: a wire (Western Union or MoneyGram are the examples the FTC names), gift cards (Amazon, Google Play, iTunes, Steam) together with the PIN, a payment app, or cryptocurrency.

The FTC’s February 2023 spotlight, [Romance scammers’ favorite lies exposed](https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2023/02/romance-scammers-favorite-lies-exposed), adds three detection rules in its own words: nobody legitimate asks you to help, or to invest, by sending cryptocurrency, reading out gift-card numbers, or wiring money; if someone tells you to send money to receive a package, it is a scam. In that spotlight’s figures for the previous year, 40 percent of people who lost money said contact started on social media and 19 percent on a website or app, and many said the conversation then moved to WhatsApp, Google Chat, or Telegram. Gift cards were the most frequently reported payment method in 2022 (24 percent of romance-scam loss reports). Cryptocurrency and bank wires together were more than 60 percent of reported losses. Median reported loss was 700 dollars for gift cards, 10,079 for cryptocurrency, and 10,000 for a bank transfer.

The April 2026 FTC spotlight says nearly 60 percent of people who reported a 2025 romance-scam loss said it started on social media. Scammers tailored the approach to the profile, then invented a crisis or offered investment advice that led onto a fake platform ([Reported losses to scams on social media eight times higher than in 2020](https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2026/04/reported-losses-scams-social-media-eight-times-higher-2020)).

**Stages.** Hook on the app. Move off platform quickly. Trust over many messages (in the short seed, this is compressed to a few turns; Oak and Shafiq’s interviewees often described weeks to months). Urgency: hospital, ticket, jail, customs. Payment ask as above. Recovery can follow, but it is more typical of the investment variant.

**Red flags.** Cannot meet or do a live video; story matches a well-known cover (oil rig, military, stuck abroad); secrecy (“don’t tell your family”); gift-card PIN; wire; crypto; a package that requires a fee.

**Hard benign lookalikes.** People who have already met, or who explicitly say the ticket is bought and no money should be sent. A gift card bought in a shop for a birthday, with the physical card handed over, is not a PIN request.

**Sources.** The two FTC pages above, plus the 2026 spotlight. Europol’s #CyberScams leaflet also tells romance targets not to send money, card details, or copies of documents, and to treat a broken camera as a warning sign ([PDF hosted by Europol](https://www.europol.europa.eu/cms/sites/default/files/documents/uk.pdf)).

## 5. Investment and pig-butchering

**Channels.** Social ads, dating apps, wrong-number texts, WhatsApp and Telegram groups, then a website that shows a fake balance.

**What authorities describe.**

- Europol, [crypto investment scams infographic](https://www.europol.europa.eu/sites/default/files/documents/EP_Scenario%20Crypto%20Scams%20infographic_EN.pdf): it can start as romance and turn into investment fraud. Paths include a social-media ad, a dating approach, a friend whose account has been taken over, and a call that walks you through a fraudulent site. Warning signs named on the sheet: returns that are too good, urgency, fake ads, and a realization only later that withdrawals do not work. Once crypto is sent, it cannot be recalled.
- Europol IOCTA 2023 defines pig-butchering as romance plus investment fraud: trust is built, savings go to a fraudulent crypto platform, and the loss is large because it happens over time. The same chapter describes a follow-on approach by people posing as lawyers or police who will recover the money for a fee ([IOCTA 2023 PDF](https://www.europol.europa.eu/cms/sites/default/files/documents/IOCTA%202023%20-%20EN.pdf)).
- FTC, April 2026 spotlight: investment scams were the largest slice of reported social-media scam losses in 2025, 1.1 billion dollars, more than half the total. The stories match Europol’s: a course, a friendly adviser, or a WhatsApp group of “successful investors”, a real-looking platform, a small withdrawal, then a larger deposit that is not an investment. Some victims then lost more to someone who said they could trace the money.
- Finanstilsynet (the Danish Financial Supervisory Authority):
  - [Kryptovaluta er Det Vilde Vesten](https://www.finanstilsynet.dk/tilsyn/inspektionsredegoerelser-og-afgoerelser/2021/sep/advarsel_kryptovaluta_280621): crypto issuers are not regulated like securities, there is no suitability test or disclosure duty of the kind that applies to shares and bonds, and scammers have room to pose as brokers. Consumers are told to be sceptical of both the broker and the product.
  - [Private investorer advares mod upålidelig information fra sociale medier](https://www.finanstilsynet.dk/nyheder-og-presse/nyheder-og-pressemeddelelser/2021/mar/advarsel_sociale_medier_240321) (24 March 2021): do not treat online tips, day-trading, leverage, or bitcoin how-tos as a reliable plan. The office compares those products to a lottery for ordinary investors.
  - [Vær kritisk overfor finfluencernes investeringstips](https://www.finanstilsynet.dk/nyheder-og-presse/nyheder-og-pressemeddelelser/2024/jun/vaer-kritisk-overfor-finfluencernes-investeringstips-) (June 2024): stop before buying on a social-media tip; do not invest on impulse because something is “hot”.

**Academic shape of the chat.** Oak and Shafiq interviewed 26 victims. In the paper’s own summary, 76.9 percent described trust built over a long period, sometimes up to 11 months, before any investment pitch. Scammers sent pictures and sometimes did audio or video calls, so “no video” is not a reliable negative. The lifecycle they report has seven stages and can continue into an encore scam. This playbook does **not** name those seven stages, because the pages read for this note did not list the seven labels, and inventing them would be worse than using the coarser tags above.

**Red flags.** Unsolicited investment help; guaranteed or daily returns; a group chat full of screenshots of profit; deposit to a platform you did not seek out; a small withdrawal followed by pressure to add more; a fee to unlock a withdrawal; a new “investigator” after the loss.

**Hard benign lookalikes.** Two friends discussing a purchase one of them already made, with no deposit address and no promise of profit. A person who says they do not want tips and will talk to their own bank.

## 6. Fake bank, fake authority, fake MobilePay

**Channels.** SMS, phone, and the same chat apps. Often two steps.

**What public warnings say.**

- Sydøstjyllands Politi, in the same “falske børn” warning: companies and public authorities will not call and ask you to transfer money or to hand over MitID, account details, and the like. The officer quoted, Brian Kristiansen, tells people to check even when the sender says the situation is acute. The check should be a call to the child, or to the authority, on the number you already use.
- Tænk’s four-types article, “svindel i flere trin”: an SMS pretends to be MobilePay and sends you to a link to “verify”. Then someone calls, claims to be the bank, says they can see you were tricked, and asks for details to fix it. Ulla Malling’s advice: hang up, and if you need the bank, call the official number yourself.
- FTC, [Only scammers tell you to buy a gift card to pay them](https://consumer.ftc.gov/consumer-alerts/2024/10/only-scammers-tell-you-buy-gift-card-pay-them): the sender claims to be a government agency or a company you know, demands payment immediately, and wants a gift card. No real business or government agency tells you to buy a gift card to pay them. The FTC’s own banner on consumer.ftc.gov says the FTC will not threaten you, tell you to move money “to protect it”, or tell you to withdraw cash or buy gold and hand it to someone.
- Europol #CyberScams leaflet: do not give a card PIN or online-banking password; do not move money to another account because a caller told you to; a bank will not ask for those things. Do not call back on a number the caller themselves provided.

**Stages.** Hook: fear (unauthorized payment, account lock, a child in trouble with the police). Urgency is almost immediate. Payment ask: MitID approval, a one-time code, a “safe account”, gift cards, or gold. Move off platform appears when an SMS link is followed by a phone call. Recovery is the second caller who offers to repair the first scam.

**Red flags.** The bank texting a code and asking you to read it back; any request for MitID; a “safe account” in another person’s name; gift cards or crypto to “protect” a balance; instructions not to hang up.

**Hard benign lookalikes.** A message that names a charge and tells you to call the number on the card, and that does not ask for a code, a MitID approval, or a transfer. Spouses forwarding that kind of message to each other.

## 7. Job chats that are really mule or gift-card work

**Channels.** WhatsApp, Telegram, email, and job-board messages.

**What public warnings say.**

- Europol, [Money muling](https://www.europol.europa.eu/operations-services-and-innovation/public-awareness-and-prevention-guides/money-muling): mules are recruited with job ads and direct messages on WhatsApp, Viber, Telegram, email, and social media, and sometimes in person. The page says more than 90 percent of mule transactions identified in the European Money Mule Actions are linked to cybercrime, including online auction fraud, e-commerce fraud, and romance scams. Warning signs on the page: the ad copies a real company; the email is a free webmail address that does not match the company; an overseas firm wants “local representatives” or “agents” to avoid fees or taxes; the job is transferring money or goods; duties are vague; there are no education or experience requirements. Targets named on the page include newcomers, students, people in financial difficulty, and people under 35, with recruitment of younger people also described.
- FTC, [Mystery shopping, (fake) checks, and gift cards](https://consumer.ftc.gov/consumer-alerts/2024/04/mystery-shopping-fake-checks-gift-cards) (April 2024): never deposit a check in order to buy gift cards and send the numbers back, as a mystery-shopper task or as any other job. The check is fake. The bank can take weeks to discover that, and you owe the money. Guaranteed high earnings are a scam signal. The longer fake-check article also describes a “personal assistant” who is sent a check and told to buy gift cards and return the PINs ([How To Spot, Avoid, and Report Fake Check Scams](https://consumer.ftc.gov/articles/how-spot-avoid-and-report-fake-check-scams)).

**Stages.** Hook: easy money, no experience. Trust: a polished name or a copied brand. Move off platform: “details on Telegram”. Payment ask: receive money and forward it, or buy gift cards with a check and send the codes. Urgency: the transfer has to go out today.

**Red flags.** Payment for the use of your account; secrecy from your bank; a job whose only duty is moving funds; gift-card PINs as the work product; a check that arrives before any real employment check.

**Hard benign lookalikes.** An interview scheduled for a named role, with no payment, no check, and no request to use your account.

## How a detector should use this

Score the **counterparty’s** turns, in order. A single word such as MobilePay, PayPal, “gift card”, or “haster” is a weak feature: the seed’s benign chats use those words on purpose. Stronger features are combinations: new number plus refusal to take a call; payee name mismatch; off-platform plus pay before handover; overpayment plus “send the difference”; gift-card PIN or MitID; guaranteed return plus a deposit address; a recovery pitch after a loss.

Do not train on raw rows from the public SMS and Discord sets inside this repository. `datasets.md` explains why. The dialogues in `data/chat-scams/seed.jsonl` are synthetic, written to these pages, and marked `source: synthetic`.
