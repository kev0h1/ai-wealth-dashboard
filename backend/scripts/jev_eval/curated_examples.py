"""Curated, per-category example merchant names for the G178 tuning round
(variant `v3_curated_examples`).

Firewall rule (ENGINE.md): user text never reaches another user's prompt,
and a global option carries no user text at all. Everything in this file is
a public UK brand or generic payment label authored by us from general
knowledge. It contains NO user-derived text: nothing here was read from
transactions, corrections, merchant catalogues or any database, so it is
safe to ship in a global Choice option. Do not add a name to this file by
copying it out of a dataset row or a user's data.

Other and the deterministic movement kinds (Transfer, Savings, Debt,
Investment) are intentionally absent: Other never carries examples, and the
movement kinds are never offered as options.
"""
from __future__ import annotations

CURATED_EXAMPLES: dict[str, list[str]] = {
    "Groceries": ["Tesco", "Sainsbury's", "Aldi", "Lidl", "Co-op", "Ocado", "Waitrose", "Asda"],
    "Eating Out": ["Greggs", "Pret A Manger", "Nando's", "Deliveroo", "Just Eat", "Costa Coffee", "Wagamama", "Domino's"],
    "Transport": ["TfL", "Trainline", "Uber", "Shell", "BP", "National Rail", "Bolt", "Ringgo"],
    "Entertainment": ["Odeon", "Vue Cinemas", "Cineworld", "Ticketmaster", "Steam", "PlayStation Store", "Bowlplex", "National Trust"],
    "Shopping": ["Amazon", "Argos", "Next", "Primark", "IKEA", "Currys", "John Lewis", "H&M"],
    "Bills": ["British Gas", "Octopus Energy", "Thames Water", "Sky", "BT", "Virgin Media", "Council Tax", "Aviva Insurance"],
    "Mortgage": ["Nationwide Building Society", "Santander Mortgage", "Skipton Building Society", "Yorkshire Building Society", "Coventry Building Society", "Mortgage Payment"],
    "Car finance": ["Black Horse Finance", "Close Brothers Motor Finance", "Motonovo Finance", "Santander Consumer Finance", "BMW Financial Services", "Car Finance Payment"],
    "Subscriptions": ["Netflix", "Spotify", "Disney+", "Apple.com/bill", "Amazon Prime", "NOW TV", "YouTube Premium", "Audible"],
    "Health": ["Boots", "Superdrug Pharmacy", "PureGym", "The Gym Group", "Specsavers", "Bupa", "Dentist", "NHS Prescription"],
    "Beauty": ["Barber", "Hairdresser", "Sephora", "Lush", "The Body Shop", "Space NK", "Nail Salon"],
    "Travel": ["Ryanair", "easyJet", "British Airways", "Booking.com", "Airbnb", "Premier Inn", "Jet2", "Eurostar"],
    "Software": ["Adobe", "Microsoft 365", "JetBrains", "GitHub", "Dropbox", "Notion", "Canva"],
    "Income": ["Salary", "HMRC Refund", "Cashback", "Child Benefit", "Pension Payment", "Dividend"],
    "Cash": ["ATM Withdrawal", "Cashpoint", "Cash Withdrawal", "Post Office Cash", "Link ATM"],
    "Charity": ["Cancer Research UK", "Oxfam", "British Red Cross", "Save the Children", "RSPCA", "Macmillan Cancer Support", "Comic Relief"],
}
