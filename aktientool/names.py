"""Deutsche Bezeichnungen für Sektoren, Branchen und Länder (Yahoo liefert englische Namen und ISO-Ländercodes)."""

from __future__ import annotations

import re

SECTORS = {
    "Technology": "Informationstechnologie", "Healthcare": "Gesundheitswesen", "Financial Services": "Finanzen",
    "Consumer Cyclical": "Zyklischer Konsum", "Consumer Defensive": "Basiskonsum", "Industrials": "Industrie",
    "Energy": "Energie", "Utilities": "Versorger", "Real Estate": "Immobilien", "Basic Materials": "Grundstoffe",
    "Communication Services": "Kommunikation",
}

# Schlüssel in der Schreibweise des Yahoo-Screeners („Banks—Regional“); das Profil liefert „Banks - Regional“
INDUSTRIES = {
    # Grundstoffe
    "Agricultural Inputs": "Agrarchemie & Dünger", "Aluminum": "Aluminium", "Building Materials": "Baustoffe",
    "Chemicals": "Chemie", "Coking Coal": "Kokskohle", "Copper": "Kupfer", "Gold": "Gold",
    "Lumber & Wood Production": "Holz & Holzprodukte", "Other Industrial Metals & Mining": "Industriemetalle & Bergbau",
    "Other Precious Metals & Mining": "Edelmetalle & Bergbau", "Paper & Paper Products": "Papier & Papierprodukte",
    "Silver": "Silber", "Specialty Chemicals": "Spezialchemie", "Steel": "Stahl",
    # Kommunikation
    "Advertising Agencies": "Werbeagenturen", "Broadcasting": "Rundfunk",
    "Electronic Gaming & Multimedia": "Videospiele & Multimedia", "Entertainment": "Unterhaltung",
    "Internet Content & Information": "Internetdienste & -inhalte", "Publishing": "Verlage",
    "Telecom Services": "Telekommunikation",
    # Zyklischer Konsum
    "Apparel Manufacturing": "Bekleidungshersteller", "Apparel Retail": "Bekleidungshandel",
    "Auto & Truck Dealerships": "Autohandel", "Auto Manufacturers": "Autohersteller", "Auto Parts": "Autozulieferer",
    "Department Stores": "Kaufhäuser", "Footwear & Accessories": "Schuhe & Accessoires",
    "Furnishings, Fixtures & Appliances": "Möbel & Haushaltsgeräte", "Gambling": "Glücksspiel",
    "Home Improvement Retail": "Baumärkte", "Internet Retail": "Onlinehandel", "Leisure": "Freizeit",
    "Lodging": "Hotels", "Luxury Goods": "Luxusgüter", "Packaging & Containers": "Verpackungen",
    "Personal Services": "Persönliche Dienstleistungen", "Recreational Vehicles": "Freizeitfahrzeuge",
    "Residential Construction": "Wohnungsbau", "Resorts & Casinos": "Resorts & Casinos", "Restaurants": "Restaurants",
    "Specialty Retail": "Fachhandel", "Textile Manufacturing": "Textilherstellung",
    "Travel Services": "Reisedienstleistungen",
    # Basiskonsum
    "Beverages—Brewers": "Brauereien", "Beverages—Non-Alcoholic": "Alkoholfreie Getränke",
    "Beverages—Wineries & Distilleries": "Wein & Spirituosen", "Confectioners": "Süßwaren",
    "Discount Stores": "Discounter", "Education & Training Services": "Bildung & Weiterbildung",
    "Farm Products": "Agrarprodukte", "Food Distribution": "Lebensmittelgroßhandel",
    "Grocery Stores": "Lebensmittelhandel", "Household & Personal Products": "Haushalts- & Körperpflegeprodukte",
    "Packaged Foods": "Nahrungsmittel", "Tobacco": "Tabak",
    # Energie
    "Oil & Gas Drilling": "Öl & Gas: Bohrungen", "Oil & Gas E&P": "Öl & Gas: Förderung",
    "Oil & Gas Equipment & Services": "Öl & Gas: Ausrüstung & Service", "Oil & Gas Integrated": "Öl & Gas: integriert",
    "Oil & Gas Midstream": "Öl & Gas: Transport & Speicher", "Oil & Gas Refining & Marketing": "Öl & Gas: Raffinerie & Vertrieb",
    "Thermal Coal": "Kraftwerkskohle", "Uranium": "Uran",
    # Finanzen
    "Asset Management": "Vermögensverwaltung", "Banks—Diversified": "Banken: Großbanken",
    "Banks—Regional": "Banken: Regionalbanken", "Capital Markets": "Kapitalmärkte & Investmentbanken",
    "Credit Services": "Kreditdienstleistungen", "Financial Conglomerates": "Finanzkonglomerate",
    "Financial Data & Stock Exchanges": "Finanzdaten & Börsen", "Insurance Brokers": "Versicherungsmakler",
    "Insurance—Diversified": "Versicherungen: diversifiziert", "Insurance—Life": "Versicherungen: Leben",
    "Insurance—Property & Casualty": "Versicherungen: Sach & Unfall", "Insurance—Reinsurance": "Rückversicherungen",
    "Insurance—Specialty": "Versicherungen: Spezial", "Mortgage Finance": "Hypothekenfinanzierung",
    "Shell Companies": "Mantelgesellschaften",
    # Gesundheitswesen
    "Biotechnology": "Biotechnologie", "Diagnostics & Research": "Diagnostik & Forschung",
    "Drug Manufacturers—General": "Pharma: Großkonzerne", "Drug Manufacturers—Specialty & Generic": "Pharma: Spezial & Generika",
    "Health Information Services": "Gesundheits-IT", "Healthcare Plans": "Krankenversicherer",
    "Medical Care Facilities": "Kliniken & Pflege", "Medical Devices": "Medizingeräte",
    "Medical Distribution": "Medizingroßhandel", "Medical Instruments & Supplies": "Medizinbedarf & Instrumente",
    "Pharmaceutical Retailers": "Apotheken & Drogerien",
    # Industrie
    "Aerospace & Defense": "Luftfahrt & Verteidigung", "Airlines": "Fluggesellschaften",
    "Airports & Air Services": "Flughäfen & Luftfahrtdienste", "Building Products & Equipment": "Bauprodukte & -ausrüstung",
    "Business Equipment & Supplies": "Büroausstattung", "Conglomerates": "Mischkonzerne", "Consulting Services": "Beratung",
    "Electrical Equipment & Parts": "Elektrotechnik", "Engineering & Construction": "Bau & Ingenieurwesen",
    "Farm & Heavy Construction Machinery": "Land- & Baumaschinen", "Industrial Distribution": "Industriehandel",
    "Infrastructure Operations": "Infrastrukturbetreiber", "Integrated Freight & Logistics": "Logistik",
    "Marine Shipping": "Schifffahrt", "Metal Fabrication": "Metallverarbeitung",
    "Pollution & Treatment Controls": "Umwelttechnik", "Railroads": "Eisenbahnen",
    "Rental & Leasing Services": "Vermietung & Leasing", "Security & Protection Services": "Sicherheitsdienste & -technik",
    "Specialty Business Services": "Unternehmensdienstleistungen", "Specialty Industrial Machinery": "Maschinenbau",
    "Staffing & Employment Services": "Personaldienstleister", "Tools & Accessories": "Werkzeuge",
    "Trucking": "Straßengüterverkehr", "Waste Management": "Entsorgung",
    # Immobilien
    "REIT—Diversified": "REIT: diversifiziert", "REIT—Healthcare Facilities": "REIT: Gesundheitsimmobilien",
    "REIT—Hotel & Motel": "REIT: Hotels", "REIT—Industrial": "REIT: Industrie & Logistik", "REIT—Mortgage": "REIT: Hypotheken",
    "REIT—Office": "REIT: Büro", "REIT—Residential": "REIT: Wohnen", "REIT—Retail": "REIT: Einzelhandel",
    "REIT—Specialty": "REIT: Spezial", "Real Estate Services": "Immobiliendienstleistungen",
    "Real Estate—Development": "Immobilienentwicklung", "Real Estate—Diversified": "Immobilien: diversifiziert",
    # Informationstechnologie
    "Communication Equipment": "Kommunikationstechnik", "Computer Hardware": "Computer-Hardware",
    "Consumer Electronics": "Unterhaltungselektronik", "Electronic Components": "Elektronische Bauteile",
    "Electronics & Computer Distribution": "Elektronikhandel", "Information Technology Services": "IT-Dienstleistungen",
    "Scientific & Technical Instruments": "Mess- & Labortechnik",
    "Semiconductor Equipment & Materials": "Halbleiterausrüstung & -materialien", "Semiconductors": "Halbleiter",
    "Software—Application": "Software: Anwendungen", "Software—Infrastructure": "Software: Infrastruktur", "Solar": "Solar",
    # Versorger
    "Utilities—Diversified": "Versorger: diversifiziert", "Utilities—Independent Power Producers": "Unabhängige Stromerzeuger",
    "Utilities—Regulated Electric": "Stromversorger", "Utilities—Regulated Gas": "Gasversorger",
    "Utilities—Regulated Water": "Wasserversorger", "Utilities—Renewable": "Erneuerbare Energien",
}

CONTINENTS = ["Europa", "Nordamerika", "Südamerika", "Asien", "Afrika", "Ozeanien"]

# ISO-Ländercode -> (deutscher Name, Kontinent). Auch Sitzländer aus ISINs (z. B. Irland, Luxemburg, Bermuda).
COUNTRIES = {
    "US": ("USA", "Nordamerika"), "CA": ("Kanada", "Nordamerika"), "MX": ("Mexiko", "Nordamerika"),
    "BM": ("Bermuda", "Nordamerika"), "PR": ("Puerto Rico", "Nordamerika"), "PA": ("Panama", "Nordamerika"),
    "BS": ("Bahamas", "Nordamerika"), "KY": ("Kaimaninseln", "Nordamerika"), "VG": ("Britische Jungferninseln", "Nordamerika"),
    "CW": ("Curaçao", "Nordamerika"), "AN": ("Niederländische Antillen", "Nordamerika"), "BB": ("Barbados", "Nordamerika"),
    "JM": ("Jamaika", "Nordamerika"), "CR": ("Costa Rica", "Nordamerika"),
    "BR": ("Brasilien", "Südamerika"), "AR": ("Argentinien", "Südamerika"), "CL": ("Chile", "Südamerika"),
    "CO": ("Kolumbien", "Südamerika"), "PE": ("Peru", "Südamerika"), "UY": ("Uruguay", "Südamerika"),
    "DE": ("Deutschland", "Europa"), "AT": ("Österreich", "Europa"), "CH": ("Schweiz", "Europa"),
    "LI": ("Liechtenstein", "Europa"), "FR": ("Frankreich", "Europa"), "NL": ("Niederlande", "Europa"),
    "BE": ("Belgien", "Europa"), "LU": ("Luxemburg", "Europa"), "GB": ("Großbritannien", "Europa"),
    "IE": ("Irland", "Europa"), "IT": ("Italien", "Europa"), "ES": ("Spanien", "Europa"), "PT": ("Portugal", "Europa"),
    "DK": ("Dänemark", "Europa"), "SE": ("Schweden", "Europa"), "NO": ("Norwegen", "Europa"), "FI": ("Finnland", "Europa"),
    "IS": ("Island", "Europa"), "FO": ("Färöer", "Europa"), "PL": ("Polen", "Europa"), "CZ": ("Tschechien", "Europa"),
    "SK": ("Slowakei", "Europa"), "HU": ("Ungarn", "Europa"), "SI": ("Slowenien", "Europa"), "HR": ("Kroatien", "Europa"),
    "RO": ("Rumänien", "Europa"), "BG": ("Bulgarien", "Europa"), "GR": ("Griechenland", "Europa"), "CY": ("Zypern", "Europa"),
    "MT": ("Malta", "Europa"), "EE": ("Estland", "Europa"), "LV": ("Lettland", "Europa"), "LT": ("Litauen", "Europa"),
    "RS": ("Serbien", "Europa"), "CS": ("Serbien", "Europa"), "RU": ("Russland", "Europa"), "UA": ("Ukraine", "Europa"),
    "TR": ("Türkei", "Europa"), "MC": ("Monaco", "Europa"), "JE": ("Jersey", "Europa"), "GG": ("Guernsey", "Europa"),
    "IM": ("Isle of Man", "Europa"), "GI": ("Gibraltar", "Europa"),
    "JP": ("Japan", "Asien"), "CN": ("China", "Asien"), "HK": ("Hongkong", "Asien"), "MO": ("Macau", "Asien"),
    "TW": ("Taiwan", "Asien"), "KR": ("Südkorea", "Asien"), "IN": ("Indien", "Asien"), "SG": ("Singapur", "Asien"),
    "MY": ("Malaysia", "Asien"), "TH": ("Thailand", "Asien"), "ID": ("Indonesien", "Asien"), "PH": ("Philippinen", "Asien"),
    "VN": ("Vietnam", "Asien"), "PK": ("Pakistan", "Asien"), "BD": ("Bangladesch", "Asien"), "LK": ("Sri Lanka", "Asien"),
    "KZ": ("Kasachstan", "Asien"), "MN": ("Mongolei", "Asien"), "GE": ("Georgien", "Asien"),
    "IL": ("Israel", "Asien"), "SA": ("Saudi-Arabien", "Asien"), "AE": ("Vereinigte Arabische Emirate", "Asien"),
    "QA": ("Katar", "Asien"), "KW": ("Kuwait", "Asien"), "BH": ("Bahrain", "Asien"), "OM": ("Oman", "Asien"),
    "JO": ("Jordanien", "Asien"),
    "ZA": ("Südafrika", "Afrika"), "EG": ("Ägypten", "Afrika"), "MA": ("Marokko", "Afrika"), "NG": ("Nigeria", "Afrika"),
    "KE": ("Kenia", "Afrika"), "MU": ("Mauritius", "Afrika"), "LR": ("Liberia", "Afrika"),
    "AU": ("Australien", "Ozeanien"), "NZ": ("Neuseeland", "Ozeanien"), "PG": ("Papua-Neuguinea", "Ozeanien"),
    "MH": ("Marshallinseln", "Ozeanien"),
}

_DASH = re.compile(r"\s*(?:—|–| - )\s*")


def industry_de(name: str | None) -> str | None:
    if not name:
        return name
    return INDUSTRIES.get(_DASH.sub("—", name.strip()), name)
