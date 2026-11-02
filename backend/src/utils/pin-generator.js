// Unique 6-digit PINs. Every room PIN goes through this generator, so
// duplicates are impossible across rooms and tests can assert uniqueness.
export class PinGenerator {
  constructor(occupied = new Set()) {
    this.occupied = occupied;
  }

  generate() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      if (!this.occupied.has(pin)) return pin;
    }
    throw new Error("could not generate a unique room PIN");
  }
}

export const pinGenerator = new PinGenerator();

export default pinGenerator;
