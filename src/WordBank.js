const wordsData = require('./words.json');

const classicWords = wordsData.classic;
const blindPairs = wordsData.blind_pairs;
const categories = Object.keys(classicWords);

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function createSession() {
  const usedWords = new Set();
  const usedPairs = new Set();

  function getRandomWord(category) {
    let pool = [];

    if (category && category !== 'all' && classicWords[category]) {
      pool = classicWords[category].filter((w) => !usedWords.has(w));
      if (pool.length === 0) {
        pool = classicWords[category];
      }
    } else {
      for (const cat of categories) {
        for (const w of classicWords[cat]) {
          if (!usedWords.has(w)) pool.push(w);
        }
      }
      if (pool.length === 0) {
        for (const cat of categories) {
          pool.push(...classicWords[cat]);
        }
      }
    }

    const word = pickRandom(pool);
    usedWords.add(word);
    return word;
  }

  function getWordPair(category) {
    let pool = [];

    if (category && category !== 'all' && blindPairs[category]) {
      pool = blindPairs[category].filter(
        (pair) => !usedPairs.has(pair[0] + '|' + pair[1])
      );
      if (pool.length === 0) {
        pool = blindPairs[category];
      }
    } else {
      for (const cat of categories) {
        for (const pair of blindPairs[cat]) {
          if (!usedPairs.has(pair[0] + '|' + pair[1])) pool.push(pair);
        }
      }
      if (pool.length === 0) {
        for (const cat of categories) {
          pool.push(...blindPairs[cat]);
        }
      }
    }

    const pair = pickRandom(pool);
    usedPairs.add(pair[0] + '|' + pair[1]);

    const shuffled = Math.random() < 0.5;
    return {
      artistWord: shuffled ? pair[1] : pair[0],
      imposterWord: shuffled ? pair[0] : pair[1],
    };
  }

  function reset() {
    usedWords.clear();
    usedPairs.clear();
  }

  return { getRandomWord, getWordPair, reset };
}

module.exports = { createSession };
