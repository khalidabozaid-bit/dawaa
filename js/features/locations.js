// js/features/locations.js
import { DB } from '../core/db.js';
import { Utils } from '../core/utils.js';
import { Categories } from './categories.js';

/**
 * Locations Management Feature (v18.0.0)
 * Manages storage locations (Pharmacy, Fridge, Cabinets...) and their allowed categories.
 */

export const DEFAULT_LOCATIONS = [
    {
        id: 'loc_pharmacy',
        nameAR: 'الصيدلية',
        nameEN: 'Pharmacy',
        icon: 'bx-clinic',
        color: '#0ea5e9',
        allowedCategories: ['all'],
        description: 'الصرف اليومي وجميع الأدوية الأساسية'
    },
    {
        id: 'loc_cabinet',
        nameAR: 'الدولاب الرئيسي',
        nameEN: 'Main Cabinet',
        icon: 'bx-cabinet',
        color: '#8b5cf6',
        allowedCategories: ['all'],
        description: 'تخزين الأدوية والمستلزمات العامة'
    },
    {
        id: 'loc_fridge',
        nameAR: 'الثلاجة',
        nameEN: 'Medical Refrigerator',
        icon: 'bx-fridge',
        color: '#06b6d4',
        allowedCategories: ['Injections', 'Emergency', 'Serum'],
        description: 'الأمصال وحقن التبريد والأدوية الحساسة للحرارة'
    },
    {
        id: 'loc_emergency',
        nameAR: 'دولاب الطوارئ',
        nameEN: 'Emergency Cabinet',
        icon: 'bx-first-aid',
        color: '#ef4444',
        allowedCategories: ['Injections', 'Emergency', 'NSAID'],
        description: 'أدوية الحالات الحرجة والإسعافات الأولية'
    },
    {
        id: 'loc_reception',
        nameAR: 'دولاب الاستقبال',
        nameEN: 'Reception Cabinet',
        icon: 'bx-capsule',
        color: '#10b981',
        allowedCategories: ['Anti-Flu', 'Laryng.', 'NSAID'],
        description: 'أدوية البرد والمسكنات السريعة'
    },
    {
        id: 'loc_ambulance',
        nameAR: 'سيارة الإسعاف',
        nameEN: 'Ambulance Kit',
        icon: 'bx-ambulance',
        color: '#f59e0b',
        allowedCategories: ['Injections', 'Emergency'],
        description: 'حقن ومستلزمات الطوارئ المتنقلة'
    }
];

export const Locations = {
    async init() {
        await this.seedDefaultLocations();
    },

    async seedDefaultLocations() {
        try {
            const existing = await DB.getAll('locations');
            if (!existing || existing.length === 0) {
                console.log('Locations: Seeding default medical storage locations...');
                for (const loc of DEFAULT_LOCATIONS) {
                    await DB.put('locations', loc);
                }
            }
        } catch (err) {
            console.warn('Locations seed error:', err);
        }
    },

    async getAll() {
        await this.seedDefaultLocations();
        const locs = (await DB.getAll('locations')) || [];
        return locs.sort((a, b) => (a.nameAR || '').localeCompare(b.nameAR || ''));
    },

    async get(id) {
        if (!id) return null;
        return await DB.get('locations', id);
    },

    async findIdByName(name) {
        if (!name) return null;
        const locs = await this.getAll();
        const found = locs.find(l => l.nameAR === name || l.nameEN === name || l.id === name);
        return found ? found.id : null;
    },

    async save(locationData) {
        const id = locationData.id || `loc_${Utils.generateId()}`;
        const loc = {
            id,
            nameAR: locationData.nameAR || 'مكان جديد',
            nameEN: locationData.nameEN || locationData.nameAR || '',
            icon: locationData.icon || 'bx-map-pin',
            color: locationData.color || '#3b82f6',
            allowedCategories: locationData.allowedCategories && locationData.allowedCategories.length > 0 
                ? locationData.allowedCategories 
                : ['all'],
            description: locationData.description || '',
            updatedAt: new Date().toISOString()
        };
        await DB.put('locations', loc);
        return loc;
    },

    async delete(id) {
        if (!id) return false;
        await DB.delete('locations', id);
        return true;
    },

    /**
     * Resolves the categories that can be present in a location.
     */
    async getCategoriesForLocation(locationId) {
        const loc = await this.get(locationId);
        const allCats = await Categories.getAllSorted();
        
        if (!loc || !loc.allowedCategories || loc.allowedCategories.includes('all')) {
            return allCats;
        }

        const allowedSet = new Set(loc.allowedCategories);
        return allCats.filter(c => allowedSet.has(c.id));
    },

    /**
     * Resolves all medicines available for a given location, optionally filtered by category.
     */
    async getMedicinesForLocation(locationId, categoryId = null) {
        const allowedCats = await this.getCategoriesForLocation(locationId);
        const allowedCatIds = new Set(allowedCats.map(c => c.id));
        
        const allMeds = (await DB.getAll('medicineMaster')) || [];
        
        return allMeds.filter(m => {
            const matchLocCat = allowedCatIds.has(m.categoryId);
            const matchSpecificCat = !categoryId || m.categoryId === categoryId;
            return matchLocCat && matchSpecificCat;
        });
    }
};
