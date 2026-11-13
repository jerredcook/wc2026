/* "Did you know?" — short facts about international soccer, shown one at a time
   on the front page. Loaded by the page as a plain script; the tests load it
   with require(). The order they are shown in is worked out by factOrder in
   js/core.js.

   Each fact:
     lv     "new"  — explains how international soccer works, for someone new to it
            "deep" — a story or a record, for someone who already follows it
     h      the headline (short)
     t      the fact, in two or three plain sentences
     opp    optional: opponents this fact is about; shown first when the USA plays one
     leg    optional: true for a fact about two-leg ties; shown early before one
     until  optional: the last day the fact is certain to be true (YYYY-MM-DD).
            After it the fact is left out until someone checks it and moves the date.

   Every fact was checked against a source when it was added (November 2026).
   A fact that a future result could change must carry "until". */
const FACTS = [
  /* ── How it works ── */
  { lv: "new", h: "Why is an appearance called a cap?",
    t: "In 1886 England began giving each player a white silk cap for every international match. The hats faded away and the word stayed. One match for your country is one cap." },
  { lv: "new", h: "Clubs pay the players. Countries borrow them.",
    t: "Nobody is signed to a national team. Players are picked match by match from clubs all over the world, and during FIFA's official international windows a club has to let them go." },
  { lv: "new", h: "Why the matches come in bunches",
    t: "National teams play only in set windows of the calendar, when the club leagues stop. That is why there are two or three matches in ten days, and then nothing for weeks." },
  { lv: "new", h: "A friendly still counts",
    t: "A friendly has no trophy or qualification riding on it. Players still earn caps, the goals go in the record books, and the result moves the world ranking, only by less than a competitive match would." },
  { lv: "new", h: "211 teams",
    t: "FIFA has 211 member associations. The United Nations has 193 member states. England, Scotland, Wales and Northern Ireland each have their own team, and so do places such as Puerto Rico and Curaçao." },
  { lv: "new", h: "Who can play for whom?",
    t: "A player can represent a country through birth, a parent, a grandparent, or years of living there. Many qualify for two or three, and countries compete to win them over. After a competitive match, switching is hard." },
  { lv: "new", h: "What is Concacaf?",
    t: "World soccer is run in six regions. The USA plays in Concacaf: North America, Central America and the Caribbean, 41 teams in all. Its trophies include the Gold Cup and the Nations League." },
  { lv: "new", leg: true, h: "One tie, two matches",
    t: "Some knockout rounds are played over two legs: one match in each country, a few days apart, with the goals added together. A team can lose the second match and still go through." },
  { lv: "new", until: "2027-03-20", h: "What is the Nations League?",
    t: "Concacaf's competition for national teams, started in 2019 so that fewer matches would be friendlies. The U.S. men won the first three titles. Mexico won the fourth, in 2025." },
  { lv: "new", h: "Why \"soccer\"?",
    t: "It is an English word. In the 1880s students at Oxford shortened \"association football\" to \"soccer\", to tell it apart from rugby football. Britain used the word for much of the 20th century." },
  { lv: "new", until: "2027-07-24", h: "The stars on the shirt",
    t: "A star above the badge stands for a World Cup won. The U.S. women wear four: 1991, 1999, 2015 and 2019. No other country has won the women's tournament more than twice." },
  { lv: "new", until: "2028-07-01", h: "At the Olympics, only the women send their best",
    t: "Men's Olympic soccer is for players under 23, with three older players allowed. The women's tournament is full strength, so a gold medal is a major title. The USA has five: 1996, 2004, 2008, 2012 and 2024." },
  { lv: "new", h: "Yellow and red cards came from a traffic light",
    t: "The English referee Ken Aston thought of them while waiting at a light, after a World Cup match in 1966 where players could not understand the referee. They were first used at the 1970 World Cup." },
  { lv: "new", h: "Why the USA got so good at women's soccer",
    t: "A 1972 law, Title IX, made schools and colleges give women equal chances to play sport. A generation later the USA had thousands of college players, at a time when most countries had almost no women's game." },

  /* ── The next opponent ── */
  { lv: "deep", opp: ["Haiti"], h: "A Haitian scored America's most famous goal",
    t: "In 1950 the USA beat England 1–0 at the World Cup, one of the great upsets of the sport. The scorer, Joe Gaetjens, was born in Port-au-Prince and was not a U.S. citizen. Three years later he played a World Cup qualifier for Haiti." },
  { lv: "deep", opp: ["Haiti"], h: "Haiti's first World Cup goal ended a record run",
    t: "Italy's goalkeeper Dino Zoff had gone 1,142 minutes of international play without letting in a goal, which is still the record. Then Emmanuel Sanon ran through and scored on him at the 1974 World Cup." },

  /* ── The women ── */
  { lv: "deep", h: "The most-capped player ever is American",
    t: "Kristine Lilly played 354 times for the USA between 1987 and 2010. Nobody, woman or man, has played more international matches for any country." },
  { lv: "deep", h: "The first U.S. women's team wore the men's hand-me-downs",
    t: "The team was put together in 1985, practised for three days, flew to Italy with second-hand men's shirts and lost its first match 1–0 to Italy on August 18. Six years later it won the first Women's World Cup." },
  { lv: "deep", until: "2027-06-23", h: "The first Women's World Cup was not allowed the name",
    t: "In 1991 FIFA called it the \"World Championship for Women's Football for the M&M's Cup\" and cut the matches to 80 minutes. The USA won it. Michelle Akers scored 10 goals, still the most in one tournament." },
  { lv: "deep", until: "2027-06-23", h: "USA 13, Thailand 0",
    t: "The biggest win in any World Cup, men's or women's, came in 2019. Alex Morgan scored five of the goals." },
  { lv: "deep", h: "A hat-trick in 16 minutes, in a World Cup final",
    t: "Carli Lloyd scored three times in the first 16 minutes of the 2015 final against Japan. She hit the third from the halfway line. The USA won 5–2." },
  { lv: "deep", h: "90,185",
    t: "That many people filled the Rose Bowl for the 1999 Women's World Cup final, at the time the biggest crowd ever for a women's sports event. The match went to penalties and Brandi Chastain scored the last one." },
  { lv: "deep", h: "184 goals",
    t: "Abby Wambach scored 184 times for the USA. Only one player has scored more for any country, woman or man: Canada's Christine Sinclair, with 190." },
  { lv: "deep", h: "Mia Hamm, goalkeeper",
    t: "At the 1995 World Cup the U.S. goalkeeper was sent off late against Denmark after every substitute had been used. Hamm, the team's star forward, put on the gloves and finished the match in goal. Denmark did not score." },
  { lv: "deep", h: "One prize pot",
    t: "Since 2022 the U.S. women and men put their World Cup prize money together and split it evenly. U.S. Soccer was the first federation in the world to do that." },
  { lv: "deep", h: "Out by a hair",
    t: "The U.S. women had never finished lower than third at a World Cup until 2023, when Sweden beat them on penalties in the round of 16. The last kick was saved, but the ball had just crossed the line." },
  { lv: "deep", h: "Banned for 50 years",
    t: "In 1920 a women's match in England drew 53,000 people. A year later the Football Association banned women's matches from its clubs' grounds, and the ban stood until 1971. It is part of why the women's game started so late." },

  /* ── The men ── */
  { lv: "deep", until: "2030-06-01", h: "Third place at the very first World Cup",
    t: "The U.S. men reached the semifinals in 1930 and it is still their best finish. On the way Bert Patenaude scored the first hat-trick in World Cup history. FIFA made it official only in 2006." },
  { lv: "deep", h: "Dos a cero",
    t: "Four World Cup qualifiers in a row against Mexico in Columbus, Ohio (2001, 2005, 2009 and 2013) ended with the same score: USA 2, Mexico 0. It was also the score when the two met at the 2002 World Cup." },
  { lv: "deep", h: "The goal that brought the World Cup back",
    t: "In November 1989 Paul Caligiuri's long shot beat Trinidad and Tobago 1–0 and sent the USA to its first World Cup in 40 years. Five years later the tournament itself came to the United States." },
  { lv: "deep", h: "MLS exists because of a promise",
    t: "To be given the 1994 World Cup, U.S. Soccer promised FIFA it would start a top professional league. Major League Soccer kicked off in 1996." },
  { lv: "deep", h: "57 each",
    t: "Landon Donovan and Clint Dempsey share the U.S. men's scoring record with 57 goals each. Cobi Jones has played the most matches: 164." },
  { lv: "deep", h: "The 91st minute, 2010",
    t: "The USA needed a goal against Algeria to stay in the World Cup and Landon Donovan scored it in stoppage time. It won them their group, ahead of England." },

  /* ── The wider game ── */
  { lv: "deep", h: "The first international ended 0–0",
    t: "Scotland played England in Glasgow on November 30, 1872, on a cricket ground, in front of about 4,000 people. Every international match since follows from that one." },
  { lv: "deep", h: "31–0",
    t: "The biggest win in international soccer: Australia against American Samoa in 2001. Archie Thompson scored 13 of the goals. Australia later moved to the Asian region, partly to find harder matches." },
  { lv: "deep", until: "2027-07-24", h: "Eight winners in 96 years",
    t: "Only eight countries have won the men's World Cup: Brazil, Germany, Italy, Argentina, France, Uruguay, England and Spain. Five have won the women's. Only Germany and Spain have won both." },
  { lv: "deep", h: "Decided by a coin",
    t: "Before penalty shootouts, a drawn knockout match could be settled by tossing a coin. Italy reached the final of the 1968 European Championship that way. The World Cup did not see a shootout until 1982." },
  { lv: "deep", h: "The smallest country ever at a World Cup",
    t: "Curaçao, a Concacaf island of about 156,000 people, qualified for the 2026 World Cup and drew 0–0 with Ecuador there. The record had belonged to Iceland." },
];

if (typeof module === "object" && module.exports) module.exports = { FACTS };
