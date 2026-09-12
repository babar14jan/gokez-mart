import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireSuperAdmin, requireRole, authenticateCustomer } from '../middleware';
import * as ctrl from '../controllers';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Health ────────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gokez-mart-api' }));

// ── Customer auth ─────────────────────────────────────────────────────────────
router.post('/auth/send-otp',    ctrl.customerSendOtp);
router.post('/auth/verify-otp',  ctrl.customerVerifyOtp);
router.get('/auth/me',           authenticateCustomer, ctrl.customerGetMe);
router.put('/auth/profile',      authenticateCustomer, ctrl.customerUpdateProfile);
router.get('/auth/orders',       authenticateCustomer, ctrl.customerGetOrders);
router.put("/auth/orders/:id/cancel", authenticateCustomer, ctrl.customerCancelOrder);
// ── Public ────────────────────────────────────────────────────────────────────
router.get('/stores',              ctrl.getStores);
router.get('/zones',               ctrl.getZones);
router.get('/categories',          ctrl.getCategories);
router.get('/products',            ctrl.getProducts);        // ?storeId=
router.get('/products/:id',        ctrl.getProduct);         // ?storeId=
router.get('/settings/public',     ctrl.getPublicSettings);  // ?storeId=
router.post('/orders',             ctrl.placeOrder);
router.get('/orders/track',         authenticateCustomer, ctrl.trackOrder);

// ── Admin auth ────────────────────────────────────────────────────────────────
router.post('/admin/login',            ctrl.adminLogin);
router.get('/admin/me',                authenticate, ctrl.adminGetMe);
router.put('/admin/profile',           authenticate, ctrl.adminUpdateProfile);
router.put('/admin/change-password',   authenticate, ctrl.adminChangePassword);

// ── Admin stores (super_admin only) ──────────────────────────────────────────
router.get('/admin/stores',                    authenticate, ctrl.adminGetStores);
router.post('/admin/stores',                   authenticate, requireSuperAdmin, ctrl.adminCreateStore);
router.put('/admin/stores/:id',                authenticate, requireSuperAdmin, ctrl.adminUpdateStore);
router.put('/admin/stores/:id/settings',       authenticate, ctrl.adminUpdateStoreSettings);

// ── Store applications (public apply + super_admin manage) ───────────────────
router.post('/store-applications',             ctrl.submitStoreApplication);
router.get('/admin/store-applications',        authenticate, requireSuperAdmin, ctrl.adminGetStoreApplications);
router.put('/admin/store-applications/:id',    authenticate, requireSuperAdmin, ctrl.adminUpdateStoreApplication);

// ── Admin zones ───────────────────────────────────────────────────────────────
router.get('/admin/zones',         authenticate, ctrl.adminGetZones);
router.post('/admin/zones',        authenticate, ctrl.adminCreateZone);
router.put('/admin/zones/:id',     authenticate, ctrl.adminUpdateZone);
router.delete('/admin/zones/:id',  authenticate, ctrl.adminDeleteZone);

// ── Admin products ────────────────────────────────────────────────────────────
router.get('/admin/products',          authenticate, ctrl.adminGetProducts);     // ?storeId=
router.post('/admin/products',         authenticate, ctrl.adminCreateProduct);
router.put('/admin/products/:id',      authenticate, ctrl.adminUpdateProduct);
router.delete('/admin/products/:id',   authenticate, ctrl.adminDeleteProduct);

// ── Master catalog (super_admin manages, store owners read + assign) ────────
router.get('/admin/catalog',             authenticate, ctrl.adminGetCatalog);
router.post('/admin/catalog/:id/assign', authenticate, ctrl.adminAssignFromCatalog);
// ── Admin categories ──────────────────────────────────────────────────────────
router.get('/admin/categories',        authenticate, ctrl.adminGetCategories);
router.post('/admin/categories',       authenticate, ctrl.adminCreateCategory);
router.put('/admin/categories/:id',    authenticate, ctrl.adminUpdateCategory);
router.delete('/admin/categories/:id', authenticate, ctrl.adminDeleteCategory);

// ── Admin user management (super_admin only) ─────────────────────────────────
router.get('/admin/users',        authenticate, requireSuperAdmin, ctrl.adminGetUsers);
router.post('/admin/users',       authenticate, requireSuperAdmin, ctrl.adminCreateUser);
router.put('/admin/users/:id',    authenticate, requireSuperAdmin, ctrl.adminUpdateUser);
router.delete('/admin/users/:id', authenticate, requireSuperAdmin, ctrl.adminDeleteUser);

// ── Admin orders ──────────────────────────────────────────────────────────────
router.get('/admin/orders',            authenticate, ctrl.adminGetOrders);       // ?storeId=
router.put('/admin/orders/:id/status', authenticate, ctrl.adminUpdateOrderStatus);
router.post("/admin/orders/batch-dispatch", authenticate, ctrl.adminBatchDispatch);
router.put("/admin/orders/:id/terminate", authenticate, ctrl.adminTerminateOrder);// ── Admin customers ───────────────────────────────────────────────────────────
router.get('/admin/customers',         authenticate, ctrl.adminGetCustomers);

// ── Admin settings ────────────────────────────────────────────────────────────
router.get('/admin/settings',          authenticate, ctrl.adminGetSettings);     // ?storeId=
router.put('/admin/settings',          authenticate, ctrl.adminUpdateSettings);

// ── Push notifications ────────────────────────────────────────────────────────────────
router.get('/push/vapid-public-key',    ctrl.getVapidPublicKey);
router.post('/push/subscribe/customer', authenticateCustomer, ctrl.customerSavePushSub);
router.post('/push/subscribe/admin',    authenticate, ctrl.adminSavePushSub);

// ── DPDP Compliance ──────────────────────────────────────────────────────────
router.post('/auth/logout',                    authenticateCustomer, ctrl.customerLogout);
router.post('/compliance/deletion',            authenticateCustomer, ctrl.customerRequestDeletion);
router.get('/compliance/deletion',             authenticateCustomer, ctrl.customerGetDeletionStatus);
router.post('/compliance/grievances',          authenticateCustomer, ctrl.customerSubmitGrievance);
router.get('/compliance/grievances',           authenticateCustomer, ctrl.customerGetGrievances);
router.get('/admin/compliance/deletions',      authenticate, requireSuperAdmin, ctrl.adminGetDeletionRequests);
router.put('/admin/compliance/deletions/:id',  authenticate, requireSuperAdmin, ctrl.adminProcessDeletion);
router.get('/admin/compliance/grievances',     authenticate, ctrl.adminGetGrievances);
router.put('/admin/compliance/grievances/:id', authenticate, ctrl.adminRespondGrievance);
// ── Admin upload ──────────────────────────────────────────────────────────────
router.post('/admin/upload/photo',     authenticate, upload.single('photo'), ctrl.adminUploadPhoto);

// ── Inventory ─────────────────────────────────────────────────────────────────
router.get('/admin/inventory',                          authenticate, ctrl.adminGetInventory);
router.post('/admin/inventory/bulk-restock',            authenticate, ctrl.adminBulkRestock);
router.post('/admin/inventory/:productId/restock',      authenticate, ctrl.adminRestockProduct);
router.put('/admin/inventory/:productId/stock',         authenticate, ctrl.adminSetProductStock);
router.get('/admin/inventory/:productId/history',       authenticate, ctrl.adminGetInventoryHistory);

// ── Team management ────────────────────────────────────────────────────────────────
router.get('/admin/stores/:storeId/team',          authenticate, ctrl.getStoreTeam);
router.post('/admin/stores/:storeId/team',         authenticate, ctrl.addToStoreTeam);
router.put('/admin/stores/:storeId/team/:userId',  authenticate, ctrl.updateStoreTeamMember);
router.delete('/admin/stores/:storeId/team/:userId', authenticate, ctrl.removeFromStoreTeam);
router.get('/admin/users/lookup',                  authenticate, ctrl.lookupUserByPhone);
router.get('/admin/users/:userId/stores',          authenticate, ctrl.getUserStores);
router.put('/admin/stores/:id/deactivate',         authenticate, requireSuperAdmin, ctrl.deactivateStore);

export default router;
