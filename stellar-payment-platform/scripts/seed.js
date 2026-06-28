const { faker } = require('@faker-js/faker');
const { StrKey } = require('@stellar/stellar-sdk');
require('dotenv').config();

const { prisma } = require('../prismaClient');

const DEFAULT_FEDERATION_DOMAIN = 'localhost';
const SEED_COUNT = 50;

// Generate a valid Stellar public key
const generateStellarPublicKey = () => {
  // Generate a random 32-byte seed and convert to Ed25519 public key
  const seed = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    seed[i] = Math.floor(Math.random() * 256);
  }
  return StrKey.encodeEd25519PublicKey(seed);
};

// Generate a realistic username
const generateUsername = () => {
  const firstName = faker.person.firstName().toLowerCase();
  const lastName = faker.person.lastName().toLowerCase();
  const number = faker.number.int({ min: 1, max: 9999 });
  return `${firstName}.${lastName}${number}`;
};

// Normalize username to include domain
const normalizeNameTag = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return '';
  }
  return trimmed.includes('*') ? trimmed : `${trimmed}*${DEFAULT_FEDERATION_DOMAIN}`;
};

const seedDatabase = async () => {
  try {
    console.log('Starting database seeding...');
    console.log(`Generating ${SEED_COUNT} mock entries...`);

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < SEED_COUNT; i++) {
      const username = normalizeNameTag(generateUsername()).toLowerCase();
      const address = generateStellarPublicKey();
      const createdAt = faker.date.past({ years: 1 });

      try {
        await prisma.user.create({
          data: { username, address, createdAt },
        });
        inserted++;
        console.log(`✓ Inserted: ${username} -> ${address}`);
      } catch (error) {
        // P2002 — unique constraint violation (duplicate username or address)
        if (error.code === 'P2002') {
          skipped++;
          console.log(`⊘ Skipped (duplicate): ${username}`);
        } else {
          console.error(`✗ Error inserting ${username}:`, error.message);
        }
      }
    }

    console.log('\n=== Seeding Complete ===');
    console.log(`Total entries generated: ${SEED_COUNT}`);
    console.log(`Successfully inserted: ${inserted}`);
    console.log(`Skipped (duplicates): ${skipped}`);

    const count = await prisma.user.count();
    console.log(`Total entries in database: ${count}`);
  } catch (error) {
    console.error('Fatal error during seeding:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

seedDatabase();
