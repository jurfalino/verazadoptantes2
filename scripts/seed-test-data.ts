/**
 * Test Data Seed Script
 * Run with: npx tsx scripts/seed-test-data.ts
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { adopters, adoptions, adopterFlags, adopterStats } from '../src/db/schema';
import path from 'path';

async function seed() {
    const dbPath = path.resolve(process.cwd(), 'local.db');
    console.log('📦 Opening database at:', dbPath);
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite);

    console.log('🌱 Seeding test data...');

    // Test Adopters
    const testAdopters = [
        {
            id: 'test-adopter-1',
            name: 'María González',
            contactInfo: 'Tel: 555-123-4567\nEmail: maria.gonzalez@email.com\nWhatsApp: +1-555-123-4567',
            addressInfo: 'Calle Falsa 123, Buenos Aires, Argentina',
            familyMembers: 'Esposo: Juan\nHijos: Pablo (10), Ana (8)\nMascotas: Perro "Firulais"',
            status: '5',
            addedBy: 'User: gatitosolivos@gmail.com'
        },
        {
            id: 'test-adopter-2',
            name: 'Carlos Rodríguez',
            contactInfo: 'Tel: 555-987-6543\nInstagram: @carlos_pets',
            addressInfo: 'Av. Libertador 456, Montevideo, Uruguay',
            familyMembers: 'Vive solo\nTrabaja desde casa',
            status: '4',
            addedBy: 'User: gatitosolivos@gmail.com'
        },
        {
            id: 'test-adopter-3',
            name: 'Laura Fernández',
            contactInfo: 'Cel: 555-456-7890\nEmail: laura.f@work.com',
            addressInfo: 'Casa con jardín grande, zona rural',
            familyMembers: 'Familia numerosa\nExperiencia con gatos y perros',
            status: '5',
            addedBy: 'Anon: Guest'
        },
        {
            id: 'test-adopter-4',
            name: 'Pedro Sánchez - PROBLEMÁTICO',
            contactInfo: 'Tel: 555-000-0000',
            addressInfo: 'Dirección desconocida',
            familyMembers: '',
            status: '1',
            addedBy: 'User: gatitosolivos@gmail.com'
        }
    ];

    for (const adopter of testAdopters) {
        try {
            await db.insert(adopters).values({
                ...adopter,
                createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Random date in last 30 days
                updatedAt: new Date()
            }).onConflictDoNothing();
            console.log(`  ✓ Adopter: ${adopter.name}`);
        } catch (e) {
            console.log(`  ⏭ Skipped (exists): ${adopter.name}`);
        }
    }

    // Test Adoptions
    const testAdoptions = [
        { id: 'test-adoption-1', adopterId: 'test-adopter-1', animalName: 'Luna', species: 'cat', status: 'completed', rating: 5, details: 'Excelente adoptante. Luna está muy feliz en su nuevo hogar.', recordType: 'adoption' },
        { id: 'test-adoption-2', adopterId: 'test-adopter-1', animalName: 'Max', species: 'dog', status: 'completed', rating: 4, details: 'Buena adopción, perro bien cuidado.', recordType: 'adoption' },
        { id: 'test-adoption-3', adopterId: 'test-adopter-2', animalName: 'Michi', species: 'cat', status: 'completed', rating: 5, details: 'Carlos es un excelente dueño de gatos.', recordType: 'adoption' },
        { id: 'test-adoption-4', adopterId: 'test-adopter-3', animalName: 'Rocky', species: 'dog', status: 'returned', rating: 3, details: 'Devuelto por cambio de vivienda.', recordType: 'returned_pet' },
        { id: 'test-adoption-5', adopterId: 'test-adopter-3', animalName: 'Nina', species: 'cat', status: 'completed', rating: 5, details: 'Seguimiento: gata muy feliz.', recordType: 'follow_up' },
        { id: 'test-adoption-6', adopterId: 'test-adopter-4', animalName: 'Desconocido', species: 'dog', status: 'failed', rating: 1, details: 'ADVERTENCIA: Reportado por maltrato animal. No adoptar más animales.', recordType: 'observation' }
    ];

    for (const adoption of testAdoptions) {
        try {
            await db.insert(adoptions).values({
                ...adoption,
                date: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000),
                addedBy: 'User: gatitosolivos@gmail.com'
            }).onConflictDoNothing();
            console.log(`  ✓ Adoption: ${adoption.animalName} -> ${adoption.adopterId}`);
        } catch (e) {
            console.log(`  ⏭ Skipped (exists): ${adoption.animalName}`);
        }
    }

    // Test Flags
    const testFlags = [
        { id: 'test-flag-1', adopterId: 'test-adopter-1', reason: 'verified_identity', details: 'Verificado con DNI', flaggedBy: 'User: gatitosolivos@gmail.com' },
        { id: 'test-flag-2', adopterId: 'test-adopter-1', reason: 'verified_address', details: 'Dirección confirmada', flaggedBy: 'User: gatitosolivos@gmail.com' },
        { id: 'test-flag-3', adopterId: 'test-adopter-4', reason: 'abusive', details: 'Reportado por maltrato', flaggedBy: 'Anon: Guest' }
    ];

    for (const flag of testFlags) {
        try {
            await db.insert(adopterFlags).values({
                ...flag,
                createdAt: new Date()
            }).onConflictDoNothing();
            console.log(`  ✓ Flag: ${flag.reason} on ${flag.adopterId}`);
        } catch (e) {
            console.log(`  ⏭ Skipped (exists): ${flag.reason}`);
        }
    }

    // Test Stats - Distributed across time periods for 90d/1y/all testing
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const statEvents = [
        // Recent (within 90 days) - for test-adopter-1
        { adopterId: 'test-adopter-1', eventType: 'search_hit', daysAgo: 5 },
        { adopterId: 'test-adopter-1', eventType: 'search_hit', daysAgo: 15 },
        { adopterId: 'test-adopter-1', eventType: 'profile_view', daysAgo: 20 },
        { adopterId: 'test-adopter-1', eventType: 'profile_view', daysAgo: 45 },
        { adopterId: 'test-adopter-1', eventType: 'search_hit', daysAgo: 60 },

        // Between 90 days and 1 year - for test-adopter-1
        { adopterId: 'test-adopter-1', eventType: 'search_hit', daysAgo: 120 },
        { adopterId: 'test-adopter-1', eventType: 'profile_view', daysAgo: 180 },
        { adopterId: 'test-adopter-1', eventType: 'search_hit', daysAgo: 250 },
        { adopterId: 'test-adopter-1', eventType: 'profile_view', daysAgo: 300 },
        { adopterId: 'test-adopter-1', eventType: 'adoption_completed', daysAgo: 330 },

        // Older than 1 year - for test-adopter-1
        { adopterId: 'test-adopter-1', eventType: 'search_hit', daysAgo: 400 },
        { adopterId: 'test-adopter-1', eventType: 'profile_view', daysAgo: 500 },
        { adopterId: 'test-adopter-1', eventType: 'search_hit', daysAgo: 600 },
        { adopterId: 'test-adopter-1', eventType: 'adoption_completed', daysAgo: 700 },
        { adopterId: 'test-adopter-1', eventType: 'profile_view', daysAgo: 800 },

        // Test-adopter-2: mix of periods
        { adopterId: 'test-adopter-2', eventType: 'search_hit', daysAgo: 10 },
        { adopterId: 'test-adopter-2', eventType: 'profile_view', daysAgo: 30 },
        { adopterId: 'test-adopter-2', eventType: 'search_hit', daysAgo: 200 },
        { adopterId: 'test-adopter-2', eventType: 'profile_view', daysAgo: 450 },

        // Test-adopter-3: only old events
        { adopterId: 'test-adopter-3', eventType: 'search_hit', daysAgo: 400 },
        { adopterId: 'test-adopter-3', eventType: 'profile_view', daysAgo: 500 },
    ];

    for (const stat of statEvents) {
        await db.insert(adopterStats).values({
            id: crypto.randomUUID(),
            adopterId: stat.adopterId,
            eventType: stat.eventType,
            createdAt: new Date(now - stat.daysAgo * DAY)
        });
    }
    console.log(`  ✓ Added ${statEvents.length} stat events across different time periods`);

    console.log('\n✅ Test data seeded successfully!');
    console.log('\nTest accounts:');
    console.log('  - María González (ID: test-adopter-1) - Verified, 2 adoptions, rating 5');
    console.log('  - Carlos Rodríguez (ID: test-adopter-2) - 1 adoption, rating 5');
    console.log('  - Laura Fernández (ID: test-adopter-3) - 1 returned pet, 1 follow-up');
    console.log('  - Pedro Sánchez (ID: test-adopter-4) - FLAGGED as abusive, rating 1');

    process.exit(0);
}

seed().catch(console.error);
