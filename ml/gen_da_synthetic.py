"""Generate data/labeled/da_synthetic.jsonl: synthetic Danish DBA / Facebook Marketplace dialogs.
Patterns paraphrased (not copied) from public warnings: politi.dk (Københavns Politi 2022-08-30, 'Undgå at blive
svindlet...'), support.dba.dk fake-buyer articles, sikkerdigital.dk 'Vær opmærksom på svindlere', tjekdet.dk guide.
Every row: source=synthetic. 'notes' carries the pattern id (used as CV group so templates don't leak across folds).
usage: python ml/gen_da_synthetic.py"""
import json, random
from pathlib import Path

R = random.Random(42)
ITEMS = [("cykel", 1200), ("barnevogn", 900), ("sofabord", 400), ("iPhone 13", 2800), ("PS5", 2500),
         ("vinterjakke", 350), ("spisebordsstole", 600), ("el-løbehjul", 1500), ("babyautostol", 500),
         ("racercykel", 3500), ("lampe", 250), ("MacBook Air", 4500), ("kommode", 700), ("Lego-sæt", 450),
         ("sneakers str. 42", 600), ("havemøbler", 1100)]
NAMES = ["Mette", "Lars", "Sofie", "Jonas", "Camilla", "Mads", "Ida", "Frederik", "Anna", "Kasper"]
PLACES = ["Valby", "Aarhus C", "Odense", "Nørrebro", "Vejle", "Aalborg", "Roskilde", "Amager", "Esbjerg", "Herning"]
COURIER = ["PostNord", "GLS", "DAO", "UPS"]
APP = ["WhatsApp", "Telegram", "Messenger", "sms"]

# {i}=item {p}=price {n}=name {s}=place {c}=courier {a}=app {d}=discounted price
SCAM = {
 "courier_link": [
  "køber: Hej, er {i} stadig til salg?\nsælger: Ja, den er her endnu.\nkøber: Super. Jeg bor desværre langt væk, så jeg bestiller {c} til at hente den hos dig. Jeg har betalt fragten.\nkøber: Du får pengene via linket her, tast dine kortoplysninger ind og godkend med MitID, så kommer de {p} kr ind: dk-{c_l}-betaling.com",
  "køber: Hej {n}! Fin {i}. Jeg tager den til {p} kr.\nsælger: Fedt, du kan hente i {s}.\nkøber: Det kan jeg ikke nå, men en kurér fra {c} kommer i morgen. Jeg har allerede betalt leveringen, så du skal bare modtage pengene gennem linket jeg sender.\nkøber: Husk at bekræfte med dit kortnummer og MitID for at få udbetalingen.",
  "køber: Er {i} i god stand?\nsælger: Ja, næsten som ny.\nkøber: Perfekt, jeg køber den. Jeg har oprettet en sikker handel, klik på linket og udfyld dine kortoplysninger for at modtage betalingen. {c} ringer til dig i morgen og henter.",
 ],
 "off_platform": [
  "køber: Hej, jeg er meget interesseret i {i}.\nsælger: Den er stadig til salg.\nkøber: Kan du sende mig din mailadresse? Så betaler jeg for fragten på hjemmesiden og skriver alle mine oplysninger der.",
  "køber: Hej {n}, jeg vil gerne købe {i}. Skriv til mig på {a} i stedet, jeg bruger ikke DBA så meget. Hvad er dit nummer?\nsælger: Kan vi ikke bare skrive her?\nkøber: Det er nemmere på {a}, så sender jeg betalingslinket derovre.",
  "køber: Hi, I am interested in {i}. Is it still available?\nsælger: Ja, den er til salg.\nkøber: Please send me your email, I will pay with bank transfer and arrange the shipping company.",
 ],
 "fake_proof": [
  "køber: Jeg har nu overført {p} kr til dig, her er kvitteringen fra min bank.\nsælger: Jeg kan ikke se pengene endnu.\nkøber: Det tager 1-2 dage før det står på kontoen. Send venligst {i} i dag, jeg har travlt.",
  "køber: Jeg har sendt pengene på MobilePay, se skærmbilledet.\nsælger: Der er ikke kommet noget hos mig.\nkøber: Så er det en fejl hos MobilePay. Du kan roligt sende {i} nu, ellers anmelder jeg dig.",
 ],
 "overpay_abroad": [
  "køber: Hello, I buy {i} for {p} kr plus 1500 kr extra for shipping to my son in England.\nsælger: Okay?\nkøber: My bank has sent the money, but you must pay the shipping agent fee first, they will refund you.",
  "køber: Jeg overfører {p} kr plus 2000 kr til fragt til udlandet. Du skal bare sende de 2000 kr videre til fragtfirmaet via Western Union.\nsælger: Hvorfor skal jeg betale fragten?\nkøber: Det er sådan deres system virker, jeg har allerede betalt dig.",
 ],
 "seller_upfront": [
  "køber: Hej, er {i} til {d} kr stadig til salg?\nsælger: Ja, men der er mange der har skrevet. Hvis du sender {dep} kr i depositum på MobilePay, holder jeg den til dig.\nkøber: Kan jeg ikke bare komme og se den?\nsælger: Jeg er ude at rejse, så den sendes med {c}. Betal hele beløbet først, så sender jeg i dag.",
  "køber: Kan jeg komme forbi i {s} og se {i}?\nsælger: Desværre, jeg er flyttet til Jylland. Du overfører {d} kr, så sender jeg den med {c} i morgen. Jeg har mange interesserede, så skynd dig.\nkøber: Kan vi bruge en betalingsløsning med deponering?\nsælger: Nej, kun MobilePay til mit andet nummer.",
  "køber: Prisen på {d} kr er meget lav for {i}?\nsælger: Ja, jeg skal bare af med den hurtigt. Overfør til denne konto, navnet passer ikke, det er min fætters konto.",
 ],
 "relative_contact": [
  "køber: Hej, er {i} stadig til salg?\nsælger: Hej! Jeg sælger den for min bror, han har den med sig. Han er ikke på DBA, så skriv til ham på {a} på +45 12 34 56 78.",
  "køber: Hvor kan jeg hente {i}?\nsælger: Min mor står for salget, men hun er ikke god til apps. Kontakt hende på {a}, så sender hun et link til betaling og fragt.",
 ],
 "tickets": [
  "køber: Hej, jeg søger 2 billetter til koncerten på lørdag.\nsælger: Jeg har 2 stk, {d} kr pr. stk. Overfør på MobilePay, så sender jeg dem på mail.\nkøber: Kan du overdrage dem i billetapp'en?\nsælger: Nej, de er printede. Betal først, jeg har andre der venter.",
 ],
 "deposit_link": [
  "køber: Jeg sender et bud forbi efter {i}. Buddet tager sig af betalingen.\nsælger: Okay.\nkøber: Du skal bare betale en lille forsikring på 25 kr via linket, så du får den refunderet når buddet har hentet varen.",
  "køber: {c} har brug for at du udfylder pakkelabel her: {c_l}-dk-label.net. Fragten er betalt, men de skal bruge dine bankoplysninger til udbetalingen af {p} kr.",
 ],
}
HONEST = {
 "pickup_cash": [
  "køber: Hej, er {i} stadig til salg?\nsælger: Ja!\nkøber: Kan jeg hente den i morgen efter kl. 17?\nsælger: Det passer fint, adressen er i {s}. Du betaler bare med MobilePay når du har set den.\nkøber: Perfekt, ses i morgen.",
  "køber: Hej {n}, jeg vil gerne se {i}. Hvornår passer det?\nsælger: Lørdag formiddag er godt. Jeg bor i {s}.\nkøber: Super, jeg kommer kl. 10. MobilePay eller kontant?\nsælger: Begge dele er fint.",
  "køber: Jeg har lige været forbi og hentet {i}, tak for handlen!\nsælger: Tak selv, pengene er modtaget på MobilePay. God fornøjelse.",
 ],
 "haggle": [
  "køber: Hej, vil du tage {d} kr for {i}?\nsælger: Det er lidt lavt, kan du gå op på {p2} kr?\nkøber: Okay, vi siger {p2}. Kan jeg hente på søndag?\nsælger: Ja, skriv når du er på vej.",
  "køber: Er prisen til forhandling?\nsælger: Lidt, hvad tænker du?\nkøber: {d} kr og jeg henter i dag.\nsælger: Deal, jeg er hjemme fra kl. 16 i {s}.",
 ],
 "condition_q": [
  "køber: Hej, har {i} nogen ridser eller fejl?\nsælger: Der er en lille skramme på siden, ellers fungerer alt. Jeg kan sende et billede.\nkøber: Ja tak.\nsælger: Her er billedet. Du er velkommen til at se den først.",
  "køber: Hvor gammel er {i}?\nsælger: Ca. 2 år, kvittering haves.\nkøber: Fedt, kan jeg prøve den når jeg henter?\nsælger: Selvfølgelig.",
 ],
 "shipping_honest": [
  "køber: Jeg bor i Aalborg, kan du sende {i}?\nsælger: Ja, jeg kan sende med {c}. Fragten er 59 kr.\nkøber: Fint. Skal jeg betale først?\nsælger: Du kan bruge DBA's fragt og betaling, så står pengene i depot til du har fået den.\nkøber: Perfekt, jeg trykker køb nu.",
  "køber: Kan {i} sendes?\nsælger: Ja, jeg køber en pakkelabel hos {c}, og du betaler vare plus fragt på MobilePay. Jeg sender dig kvitteringen og track-nummeret.\nkøber: Det er fint, jeg har set dine anmeldelser.",
 ],
 "phone_for_pickup": [
  "køber: Jeg kommer forbi kl. 18 efter {i}. Må jeg få dit nummer, så jeg kan ringe hvis jeg ikke kan finde opgangen?\nsælger: Ja, ring på 12 34 56 78. Det er 3. sal i {s}.\nkøber: Tak, vi ses.",
  "sælger: Hej {n}, vil du stadig hente {i}?\nkøber: Ja, jeg skriver på sms når jeg holder udenfor.\nsælger: Super, du betaler på MobilePay når du har set den.",
 ],
 "tickets_honest": [
  "køber: Har du stadig billetten til lørdag?\nsælger: Ja, {d} kr. Jeg overdrager den via billetudbyderens officielle gensalg, så er du sikker.\nkøber: Perfekt, sæt den til salg der, så køber jeg.",
 ],
 "reserve_no_deposit": [
  "køber: Kan du holde {i} til mig til fredag? Jeg får først løn der.\nsælger: Ja, men hvis en anden kan hente før, giver jeg dig besked.\nkøber: Helt fair, tak.",
  "køber: Er {i} solgt?\nsælger: Nej, men en anden kommer og kigger i aften. Jeg skriver til dig hvis han ikke tager den.\nkøber: Tak, det ville være fint.",
 ],
 "giveaway_or_details": [
  "køber: Hvad er målene på {i}?\nsælger: Ca. 120 x 60 cm. Her er et link til producentens side med specifikationerne.\nkøber: Tak, den passer. Jeg henter i weekenden.",
  "sælger: Tak for interessen i {i}. Den er solgt, men jeg har en lignende til {d} kr.\nkøber: Den vil jeg gerne se, hvornår passer det?\nsælger: Onsdag aften i {s}.",
 ],
}


def fill(t):
    i, p = R.choice(ITEMS); c = R.choice(COURIER)
    d = int(p * R.choice([0.4, 0.5, 0.6]) // 10 * 10); p2 = int((p + d) / 2 // 10 * 10)
    return t.format(i=i, p=p, d=d, p2=p2, dep=R.choice([200, 300, 500]), n=R.choice(NAMES), s=R.choice(PLACES),
                    c=c, c_l=c.lower(), a=R.choice(APP))


def gen(patterns, label, total):
    rows, keys = [], [(k, j) for k, ts in patterns.items() for j in range(len(ts))]
    seen = set()
    while len(rows) < total:
        for k, j in keys:
            if len(rows) >= total:
                break
            text = fill(patterns[k][j])
            if text in seen:
                continue
            seen.add(text)
            n = sum(r["notes"].startswith(f"pattern={k}") for r in rows)
            rows.append(dict(id=f"da-syn-{label}-{k}-{n}", source="synthetic", language="da" if "Hello" not in text and "Hi," not in text else "da+en",
                             text=text, label=label, scam_type=k if label == "scam" else "", notes=f"pattern={k};template={j}"))
    return rows


if __name__ == "__main__":
    rows = gen(SCAM, "scam", 72) + gen(HONEST, "honest", 80)
    out = Path(__file__).resolve().parent.parent / "data" / "labeled" / "da_synthetic.jsonl"
    out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    print("wrote", out, len(rows))
