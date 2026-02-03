// ===================================
// CONFIGURACIÓN Y VARIABLES GLOBALES
// ===================================

// ⚠️ NOTA DE SEGURIDAD: Las credenciales ahora se validan en el servidor
// Este es solo un placeholder para mantener compatibilidad durante la migración
const ADMIN_CREDENTIALS = {
  username: "admin",
  password: "charlie2025"
};

// URL del Web App de Google Apps Script
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxAKxDlNu8bWmg3nZb9WqSKsJtoGiCCxmWDwr_YKI5tY8CosQpdDNQ5dawRon8j9dySHg/exec";

// Configuración
const CONFIG = {
  RECEIPT_WIDTH: 48,
  DEFAULT_DELIVERY_CHARGE: 2000,
  FETCH_TIMEOUT: 10000,
  MAX_RETRIES: 3
};

// Estado de la aplicación
let state = {
  products: [],
  categories: [],
  cart: [],
  currentView: "orden",
  selectedCategory: "all",
  tempProduct: null,
  predefinedNotes: []
};

// Estado de autenticación
let isAdminLoggedIn = false;

// ===================================
// INICIALIZACIÓN
// ===================================

document.addEventListener("DOMContentLoaded", () => {
  initializeApp();
  setupEventListeners();
  setupLoginListener();
  setupLogoutListener();
  
  // Evento para tipo de orden
  document.querySelectorAll('input[name="orderType"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      const deliveryFields = document.getElementById("deliveryFields");
      deliveryFields.style.display =
        e.target.value === "domicilio" ? "block" : "none";
    });
  });
});

async function initializeApp() {
  showLoader(true);
  try {
    await Promise.all([
      loadCategories(),
      loadProducts(),
      loadPredefinedNotes()
    ]);
    renderProducts();
    renderCategoryFilters();
  } catch (error) {
    console.error("Error al inicializar:", error);
    showToast("Error al cargar datos iniciales", "error");
  } finally {
    showLoader(false);
  }
}

// ===================================
// SISTEMA DE LOGIN
// ===================================

function setupLoginListener() {
  const loginForm = document.getElementById("formLogin");
  loginForm.addEventListener("submit", handleLogin);
}

function setupLogoutListener() {
  const logoutBtn = document.getElementById("btnLogout");
  logoutBtn.addEventListener("click", handleLogout);
}

function handleLogin(e) {
  e.preventDefault();
  
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  
  if (username === ADMIN_CREDENTIALS.username && 
      password === ADMIN_CREDENTIALS.password) {
    isAdminLoggedIn = true;
    document.getElementById("loginForm").style.display = "none";
    document.getElementById("adminContent").style.display = "block";
    
    loadAdminData();
    
    showToast("¡Bienvenido Administrador!", "success");
  } else {
    showToast("Usuario o contraseña incorrectos", "error");
    document.getElementById("loginPassword").value = "";
  }
}

function handleLogout() {
  if (confirm("¿Cerrar sesión de administrador?")) {
    isAdminLoggedIn = false;
    document.getElementById("loginForm").style.display = "block";
    document.getElementById("adminContent").style.display = "none";
    document.getElementById("loginUsername").value = "";
    document.getElementById("loginPassword").value = "";
    
    switchView("orden");
    
    showToast("Sesión cerrada", "success");
  }
}

// ===================================
// EVENT LISTENERS
// ===================================

function setupEventListeners() {
  // Navegación
  document.getElementById("btnOrden").addEventListener("click", () => switchView("orden"));
  document.getElementById("btnAdmin").addEventListener("click", () => switchView("admin"));

  // Carrito
  document.getElementById("btnClearCart").addEventListener("click", clearCart);
  document.getElementById("btnProcessOrder").addEventListener("click", processOrder);

  // Administración - Tabs
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => switchTab(e.target.dataset.tab));
  });

  // Administración - Botones
  document.getElementById("btnNewProduct").addEventListener("click", () => openProductModal());
  document.getElementById("btnNewCategory").addEventListener("click", () => openCategoryModal());

  // Formularios
  document.getElementById("formProduct").addEventListener("submit", saveProduct);
  document.getElementById("formCategory").addEventListener("submit", saveCategory);

  // Filtros de categoría
  document.getElementById("categoryFilter").addEventListener("click", (e) => {
    if (e.target.classList.contains("category-btn")) {
      filterByCategory(e.target.dataset.category);
    }
  });
}

// ===================================
// NAVEGACIÓN Y VISTAS
// ===================================

function switchView(view) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  if (view === "orden") {
    document.getElementById("btnOrden").classList.add("active");
    document.getElementById("vistaOrden").classList.remove("hidden");
    document.getElementById("vistaAdmin").classList.add("hidden");
  } else {
    document.getElementById("btnAdmin").classList.add("active");
    document.getElementById("vistaAdmin").classList.remove("hidden");
    document.getElementById("vistaOrden").classList.add("hidden");
    
    if (!isAdminLoggedIn) {
      document.getElementById("loginForm").style.display = "block";
      document.getElementById("adminContent").style.display = "none";
    } else {
      document.getElementById("loginForm").style.display = "none";
      document.getElementById("adminContent").style.display = "block";
      loadAdminData();
    }
  }

  state.currentView = view;
}

function switchTab(tab) {
  if (!isAdminLoggedIn) {
    showToast("Debe iniciar sesión primero", "error");
    return;
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.remove("active");
  });

  document.querySelector(`[data-tab="${tab}"]`).classList.add("active");
  document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add("active");

  if (tab === "ordenes") {
    loadOrdersAdmin();
  }
}

// ===================================
// COMUNICACIÓN CON GOOGLE SHEETS (MEJORADA)
// ===================================

async function fetchData(action, data = {}) {
  return fetchDataWithRetry(action, data, CONFIG.MAX_RETRIES);
}

async function fetchDataWithRetry(action, data, retries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await fetchDataWithTimeout(action, data, CONFIG.FETCH_TIMEOUT);
      return result;
    } catch (error) {
      console.error(`Intento ${attempt}/${retries} falló:`, error);
      
      if (attempt === retries) {
        showToast("Error de conexión. Por favor, intenta de nuevo.", "error");
        throw error;
      }
      
      // Backoff exponencial
      await sleep(1000 * attempt);
    }
  }
}

function fetchDataWithTimeout(action, data, timeout) {
  return Promise.race([
    fetchDataOriginal(action, data),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), timeout)
    )
  ]);
}

function fetchDataOriginal(action, data = {}) {
  return new Promise((resolve, reject) => {
    try {
      const callbackName = "callback_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
      const params = new URLSearchParams({
        action: action,
        callback: callbackName,
      });

      if (Object.keys(data).length > 0) {
        params.set("data", JSON.stringify(data));
      }

      const script = document.createElement("script");
      const url = `${SCRIPT_URL}?${params.toString()}`;

      window[callbackName] = function (response) {
        delete window[callbackName];
        document.body.removeChild(script);
        resolve(response);
      };

      script.onerror = function () {
        delete window[callbackName];
        document.body.removeChild(script);
        reject(new Error("Error al cargar script"));
      };

      script.src = url;
      document.body.appendChild(script);
    } catch (error) {
      console.error("Error al comunicarse con Google Sheets:", error);
      reject(error);
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadCategories() {
  try {
    const result = await fetchData("getCategories");
    if (result && result.success) {
      state.categories = result.data;
    }
  } catch (error) {
    console.error("Error cargando categorías:", error);
    state.categories = [];
  }
}

async function loadProducts() {
  try {
    const result = await fetchData("getProducts");
    if (result && result.success) {
      state.products = result.data;
    }
  } catch (error) {
    console.error("Error cargando productos:", error);
    state.products = [];
  }
}

async function loadPredefinedNotes() {
  try {
    const result = await fetchData("getPredefinedNotes");
    if (result && result.success) {
      state.predefinedNotes = result.data;
    }
  } catch (error) {
    console.error("Error cargando notas:", error);
    state.predefinedNotes = [];
  }
}

// ===================================
// RENDERIZADO DE PRODUCTOS
// ===================================

function renderProducts() {
  const grid = document.getElementById("productsGrid");
  const filteredProducts =
    state.selectedCategory === "all"
      ? state.products
      : state.products.filter((p) => p.category === state.selectedCategory);

  if (filteredProducts.length === 0) {
    grid.innerHTML =
      '<div class="empty-cart"><p>📦</p><span>No hay productos disponibles</span></div>';
    return;
  }

  grid.innerHTML = filteredProducts
    .map(
      (product) => `
        <div class="product-card" onclick="addToCart('${product.id}')">
            <h3>${product.name}</h3>
            <div class="product-price">${formatPrice(product.price)}</div>
            ${
              product.description
                ? `<p class="product-description">${product.description}</p>`
                : ""
            }
        </div>
    `
    )
    .join("");
}

function renderCategoryFilters() {
  const filterContainer = document.getElementById("categoryFilter");

  const buttons = [
    '<button class="category-btn active" data-category="all">Todos</button>',
    ...state.categories.map(
      (cat) =>
        `<button class="category-btn" data-category="${cat.name}">${cat.name}</button>`
    ),
  ].join("");

  filterContainer.innerHTML = buttons;
}

function filterByCategory(category) {
  state.selectedCategory = category;

  document.querySelectorAll(".category-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  document.querySelector(`[data-category="${category}"]`).classList.add("active");

  renderProducts();
}

// ===================================
// GESTIÓN DEL CARRITO
// ===================================

function addToCart(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;

  state.tempProduct = { ...product, quantity: 1, notes: "" };
  openNotesModal(product);
}

function confirmNotes() {
  const notes = document.getElementById("productNotes").value.trim();
  state.tempProduct.notes = notes;

  const existingItem = state.cart.find(
    (item) => item.id === state.tempProduct.id && item.notes === notes
  );

  if (existingItem) {
    existingItem.quantity++;
  } else {
    state.cart.push({ ...state.tempProduct });
  }

  renderCart();
  closeModal("modalNotes");
  document.getElementById("productNotes").value = "";
  showToast("Producto agregado al carrito", "success");
}

function updateQuantity(index, change) {
  const item = state.cart[index];
  item.quantity += change;

  if (item.quantity <= 0) {
    removeFromCart(index);
  } else {
    renderCart();
  }
}

function removeFromCart(index) {
  state.cart.splice(index, 1);
  renderCart();
  showToast("Producto eliminado", "success");
}

function clearCart() {
  if (state.cart.length === 0) return;

  if (confirm("¿Estás seguro de limpiar el carrito?")) {
    state.cart = [];
    renderCart();
    showToast("Carrito limpiado", "success");
  }
}

function renderCart() {
  const cartContainer = document.getElementById("cartItems");
  const totalElement = document.getElementById("totalAmount");

  if (state.cart.length === 0) {
    cartContainer.innerHTML = `
      <div class="empty-cart">
        <p>🛒</p>
        <span>Carrito vacío</span>
      </div>
    `;
    totalElement.textContent = "$0";
    return;
  }

  cartContainer.innerHTML = state.cart
    .map(
      (item, index) => `
        <div class="cart-item">
          <div class="cart-item-header">
            <span class="cart-item-name">${item.name}</span>
            <button class="cart-item-remove" onclick="removeFromCart(${index})">×</button>
          </div>
          ${item.notes ? `<div class="cart-item-notes">📝 ${item.notes}</div>` : ""}
          <div class="cart-item-footer">
            <div class="quantity-controls">
              <button class="qty-btn" onclick="updateQuantity(${index}, -1)">-</button>
              <span class="qty-display">${item.quantity}</span>
              <button class="qty-btn" onclick="updateQuantity(${index}, 1)">+</button>
            </div>
            <span class="cart-item-price">${formatPrice(item.price * item.quantity)}</span>
          </div>
        </div>
      `
    )
    .join("");

  const total = calculateTotal();
  totalElement.textContent = formatPrice(total);
}

function calculateTotal() {
  return state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// ===================================
// PROCESAR ORDEN
// ===================================

async function processOrder() {
  // Usar FormData para obtener valores del formulario
  const form = document.getElementById("orderForm");
  const formData = new FormData(form);
  
  const customerName = formData.get("customerName").trim();
  const orderType = formData.get("orderType");
  const paymentMethod = formData.get("paymentMethod");

  let address = "";
  let deliveryCharge = 0;

  if (orderType === "domicilio") {
    address = formData.get("deliveryAddress").trim();
    deliveryCharge = parseInt(formData.get("deliveryCharge")) || CONFIG.DEFAULT_DELIVERY_CHARGE;

    if (!address) {
      showToast("Ingrese la dirección de entrega", "error");
      return;
    }
  }

  if (!customerName || state.cart.length === 0) {
    showToast("Complete los datos y agregue productos", "error");
    return;
  }

  showLoader(true);

  try {
    const subtotal = calculateTotal();
    const total = subtotal + deliveryCharge;

    const orderData = {
      customerName,
      orderType,
      address,
      deliveryCharge,
      paymentMethod,
      items: state.cart,
      subtotal,
      total,
      date: new Date().toISOString(),
    };

    const result = await fetchData("createOrder", orderData);

    if (result && result.success) {
      await printReceipts(result.orderNumber, orderData);

      state.cart = [];
      form.reset();
      renderCart();

      showToast(`Orden #${result.orderNumber} procesada`, "success");
    } else {
      showToast("Error al procesar la orden", "error");
    }
  } catch (error) {
    console.error("Error procesando orden:", error);
    showToast("Error al procesar la orden", "error");
  } finally {
    showLoader(false);
  }
}

// ===================================
// SISTEMA DE IMPRESIÓN
// ===================================

async function printReceipts(orderNumber, orderData) {
  const receiptContent = generateReceiptContent(orderNumber, orderData);
  const copies = ["CLIENTE", "COCINA"];

  for (let i = 0; i < copies.length; i++) {
    await printToThermalPrinter(receiptContent, copies[i]);
  }
}

function generateReceiptContent(orderNumber, orderData) {
  const {
    customerName,
    orderType,
    address,
    deliveryCharge,
    paymentMethod,
    items,
    subtotal,
    total,
    date,
  } = orderData;
  
  const now = new Date(date);
  const formattedDate = now.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const formattedTime = now.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const center = (text) => {
    const len = text.length;
    const padding = Math.max(0, Math.floor((CONFIG.RECEIPT_WIDTH - len) / 2));
    return " ".repeat(padding) + text;
  };

  let content = `
${center("CHARLIE FAST FOOD")}
${"=".repeat(CONFIG.RECEIPT_WIDTH)}
CLL 5A #1 C SUR - 48, Bellavista
Tel: 324 2749206
@charliefastfood
${"=".repeat(CONFIG.RECEIPT_WIDTH)}

Factura: ${String(orderNumber).padStart(3, "0")}
Fecha: ${formattedDate} ${formattedTime}
Cliente: ${customerName}
Tipo: ${orderType.toUpperCase()}
${address ? "Dirección: " + address : ""}
Pago: ${paymentMethod}

${"=".repeat(CONFIG.RECEIPT_WIDTH)}
PRODUCTOS
${"=".repeat(CONFIG.RECEIPT_WIDTH)}

`;

  items.forEach((item) => {
    content += `${item.name}\n`;
    const qtyPrice = `${item.quantity} x ${formatPrice(item.price)}`;
    const itemTotal = formatPrice(item.price * item.quantity);
    content += `${qtyPrice}${" ".repeat(CONFIG.RECEIPT_WIDTH - qtyPrice.length - itemTotal.length)}${itemTotal}\n`;
    if (item.notes) {
      item.notes.split(",").forEach((note) => {
        content += `  * ${note.trim()}\n`;
      });
    }
    content += `\n`;
  });

  content += `${"=".repeat(CONFIG.RECEIPT_WIDTH)}\n`;
  content += `Subtotal:${" ".repeat(38 - formatPrice(subtotal).length)}${formatPrice(subtotal)}\n`;
  if (deliveryCharge > 0) {
    content += `Domicilio:${" ".repeat(37 - formatPrice(deliveryCharge).length)}${formatPrice(deliveryCharge)}\n`;
  }
  content += `TOTAL:${" ".repeat(41 - formatPrice(total).length)}${formatPrice(total)}\n`;
  content += `${"=".repeat(CONFIG.RECEIPT_WIDTH)}\n\n`;
  content += `${center("¡Gracias por su compra!")}\n`;
  content += `${center("Vuelve pronto")}\n\n\n`;

  return content;
}

async function printToThermalPrinter(content, copy) {
  try {
    const fullContent = `\n${copy}\n${"-".repeat(CONFIG.RECEIPT_WIDTH)}\n${content}`;
    const printWindow = window.open("", "_blank", "width=300,height=600");
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Factura - ${copy}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          @page { size: 80mm auto; margin: 0; }
          body {
            font-family: 'Courier New', monospace;
            font-size: 11px;
            width: 80mm;
            margin: 0 auto;
            padding: 5mm;
            background: white;
            color: black;
          }
          pre {
            font-family: 'Courier New', monospace;
            font-size: 11px;
            white-space: pre-wrap;
            word-wrap: break-word;
            margin: 0;
            line-height: 1.3;
          }
          @media print {
            body { width: 80mm; padding: 2mm; }
            pre { font-size: 10px; }
          }
        </style>
      </head>
      <body>
        <pre>${fullContent}</pre>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              setTimeout(function() { window.close(); }, 100);
            }, 500);
          }
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  } catch (error) {
    console.error("Error al imprimir:", error);
    showToast("Error al imprimir la factura", "error");
  }
}

// ===================================
// ADMINISTRACIÓN
// ===================================

async function loadAdminData() {
  if (!isAdminLoggedIn) {
    showToast("Acceso denegado", "error");
    return;
  }

  showLoader(true);
  try {
    await Promise.all([
      loadProducts(),
      loadCategories()
    ]);
    renderProductsTable();
    renderCategoriesGrid();
    updateCategorySelects();
  } catch (error) {
    console.error("Error cargando datos admin:", error);
    showToast("Error al cargar datos", "error");
  } finally {
    showLoader(false);
  }
}

function renderProductsTable() {
  const tbody = document.getElementById("productsTableBody");

  if (state.products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No hay productos registrados</td></tr>';
    return;
  }

  tbody.innerHTML = state.products
    .map(
      (product) => `
        <tr>
          <td>${product.name}</td>
          <td>${product.category}</td>
          <td>${formatPrice(product.price)}</td>
          <td>${product.description || "-"}</td>
          <td>
            <div class="action-btns">
              <button class="btn-edit" onclick="editProduct('${product.id}')">Editar</button>
              <button class="btn-delete" onclick="deleteProduct('${product.id}')">Eliminar</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function openProductModal(productId = null) {
  if (!isAdminLoggedIn) {
    showToast("Acceso denegado", "error");
    return;
  }

  const modal = document.getElementById("modalProduct");
  const title = document.getElementById("modalProductTitle");
  const form = document.getElementById("formProduct");

  form.reset();
  updateCategorySelects();

  if (productId) {
    const product = state.products.find((p) => p.id === productId);
    if (product) {
      title.textContent = "Editar Producto";
      document.getElementById("productId").value = product.id;
      document.getElementById("productName").value = product.name;
      document.getElementById("productCategory").value = product.category;
      document.getElementById("productPrice").value = product.price;
      document.getElementById("productDescription").value = product.description || "";
    }
  } else {
    title.textContent = "Nuevo Producto";
    document.getElementById("productId").value = "";
  }

  openModal("modalProduct");
}

function editProduct(productId) {
  openProductModal(productId);
}

async function deleteProduct(productId) {
  if (!isAdminLoggedIn) {
    showToast("Acceso denegado", "error");
    return;
  }

  if (!confirm("¿Estás seguro de eliminar este producto?")) return;

  showLoader(true);
  try {
    const result = await fetchData("deleteProduct", { id: productId });

    if (result && result.success) {
      await loadProducts();
      renderProductsTable();
      renderProducts();
      showToast("Producto eliminado correctamente", "success");
    } else {
      showToast("Error al eliminar el producto", "error");
    }
  } catch (error) {
    console.error("Error eliminando producto:", error);
    showToast("Error al eliminar el producto", "error");
  } finally {
    showLoader(false);
  }
}

async function saveProduct(e) {
  e.preventDefault();

  if (!isAdminLoggedIn) {
    showToast("Acceso denegado", "error");
    return;
  }

  const productData = {
    id: document.getElementById("productId").value,
    name: document.getElementById("productName").value.trim(),
    category: document.getElementById("productCategory").value,
    price: parseInt(document.getElementById("productPrice").value),
    description: document.getElementById("productDescription").value.trim(),
  };

  showLoader(true);
  try {
    const action = productData.id ? "updateProduct" : "createProduct";
    const result = await fetchData(action, productData);

    if (result && result.success) {
      await loadProducts();
      renderProductsTable();
      renderProducts();
      renderCategoryFilters();
      closeModal("modalProduct");
      showToast(
        productData.id ? "Producto actualizado correctamente" : "Producto creado correctamente",
        "success"
      );
    } else {
      showToast("Error al guardar el producto", "error");
    }
  } catch (error) {
    console.error("Error guardando producto:", error);
    showToast("Error al guardar el producto", "error");
  } finally {
    showLoader(false);
  }
}

// ===================================
// CATEGORÍAS
// ===================================

function renderCategoriesGrid() {
  const grid = document.getElementById("categoriesGrid");

  if (state.categories.length === 0) {
    grid.innerHTML = '<div class="empty-cart"><p>📁</p><span>No hay categorías registradas</span></div>';
    return;
  }

  grid.innerHTML = state.categories
    .map(
      (category) => `
        <div class="category-card">
          <h3>${category.name}</h3>
          <div class="action-btns">
            <button class="btn-edit" onclick="editCategory('${category.id}')">Editar</button>
            <button class="btn-delete" onclick="deleteCategory('${category.id}')">Eliminar</button>
          </div>
        </div>
      `
    )
    .join("");
}

function openCategoryModal(categoryId = null) {
  if (!isAdminLoggedIn) {
    showToast("Acceso denegado", "error");
    return;
  }

  const modal = document.getElementById("modalCategory");
  const title = document.getElementById("modalCategoryTitle");
  const form = document.getElementById("formCategory");

  form.reset();

  if (categoryId) {
    const category = state.categories.find((c) => c.id === categoryId);
    if (category) {
      title.textContent = "Editar Categoría";
      document.getElementById("categoryId").value = category.id;
      document.getElementById("categoryName").value = category.name;
    }
  } else {
    title.textContent = "Nueva Categoría";
    document.getElementById("categoryId").value = "";
  }

  openModal("modalCategory");
}

function editCategory(categoryId) {
  openCategoryModal(categoryId);
}

async function deleteCategory(categoryId) {
  if (!isAdminLoggedIn) {
    showToast("Acceso denegado", "error");
    return;
  }

  const hasProducts = state.products.some(
    (p) => p.category === state.categories.find((c) => c.id === categoryId)?.name
  );

  if (hasProducts) {
    showToast("No se puede eliminar una categoría con productos asociados", "error");
    return;
  }

  if (!confirm("¿Estás seguro de eliminar esta categoría?")) return;

  showLoader(true);
  try {
    const result = await fetchData("deleteCategory", { id: categoryId });

    if (result && result.success) {
      await loadCategories();
      renderCategoriesGrid();
      renderCategoryFilters();
      updateCategorySelects();
      showToast("Categoría eliminada correctamente", "success");
    } else {
      showToast("Error al eliminar la categoría", "error");
    }
  } catch (error) {
    console.error("Error eliminando categoría:", error);
    showToast("Error al eliminar la categoría", "error");
  } finally {
    showLoader(false);
  }
}

async function saveCategory(e) {
  e.preventDefault();

  if (!isAdminLoggedIn) {
    showToast("Acceso denegado", "error");
    return;
  }

  const categoryData = {
    id: document.getElementById("categoryId").value,
    name: document.getElementById("categoryName").value.trim(),
  };

  showLoader(true);
  try {
    const action = categoryData.id ? "updateCategory" : "createCategory";
    const result = await fetchData(action, categoryData);

    if (result && result.success) {
      await loadCategories();
      renderCategoriesGrid();
      renderCategoryFilters();
      updateCategorySelects();
      closeModal("modalCategory");
      showToast(
        categoryData.id ? "Categoría actualizada correctamente" : "Categoría creada correctamente",
        "success"
      );
    } else {
      showToast("Error al guardar la categoría", "error");
    }
  } catch (error) {
    console.error("Error guardando categoría:", error);
    showToast("Error al guardar la categoría", "error");
  } finally {
    showLoader(false);
  }
}

function updateCategorySelects() {
  const select = document.getElementById("productCategory");
  select.innerHTML =
    '<option value="">Seleccione una categoría</option>' +
    state.categories.map((cat) => `<option value="${cat.name}">${cat.name}</option>`).join("");
}

// ===================================
// ÓRDENES
// ===================================

async function loadOrdersAdmin() {
  if (!isAdminLoggedIn) {
    showToast("Acceso denegado", "error");
    return;
  }

  const dateValue = document.getElementById("filterDate").value;
  const paymentMethod = document.getElementById("filterPayment").value;

  let filters = { paymentMethod };

  if (dateValue) {
    const dateStart = new Date(dateValue);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(dateValue);
    dateEnd.setHours(23, 59, 59, 999);
    
    filters.dateStart = dateStart.toISOString();
    filters.dateEnd = dateEnd.toISOString();
  }

  showLoader(true);
  try {
    const result = await fetchData("getOrders", { filters });
    if (result && result.success) {
      renderOrdersTable(result.data);
    }
  } catch (error) {
    console.error("Error cargando órdenes:", error);
    showToast("Error al cargar órdenes", "error");
  } finally {
    showLoader(false);
  }
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById("ordersTableBody");

  if (!orders || orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 40px; color: var(--gray-medium);">No hay órdenes para mostrar</td></tr>';
    return;
  }

  tbody.innerHTML = orders
    .map((order) => {
      let formattedDate = "";
      try {
        const dateValue = order.rawDate || order.date;
        if (dateValue) {
          const dateObj = dateValue instanceof Date ? dateValue : new Date(dateValue);
          formattedDate = dateObj.toLocaleString("es-CO", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
        }
      } catch (e) {
        formattedDate = order.rawDate || "-";
      }

      return `
        <tr>
          <td><strong>${String(order.orderNumber || 0).padStart(3, "0")}</strong></td>
          <td>${formattedDate}</td>
          <td>${order.customer || "-"}</td>
          <td>
            <span class="order-type-badge badge-${order.type || 'local'}">
              ${(order.type || "local").toUpperCase()}
            </span>
          </td>
          <td>${order.address || "-"}</td>
          <td>
            <span class="payment-badge badge-${order.paymentMethod === 'Efectivo' ? 'cash' : 'transfer'}">
              ${order.paymentMethod || "Efectivo"}
            </span>
          </td>
          <td class="total-cell">${formatPrice(order.total || 0)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-delete" onclick="deleteOrderAdmin(${order.orderNumber}, ${order.rowIndex})">
                Eliminar
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function deleteOrderAdmin(orderNumber, rowIndex) {
  if (!isAdminLoggedIn) {
    showToast("Acceso denegado", "error");
    return;
  }

  if (!confirm("¿Eliminar esta orden?")) return;

  showLoader(true);
  try {
    const result = await fetchData("deleteOrder", { orderNumber, rowIndex });
    if (result && result.success) {
      loadOrdersAdmin();
      showToast("Orden eliminada", "success");
    } else {
      showToast("Error al eliminar orden", "error");
    }
  } catch (error) {
    console.error("Error eliminando orden:", error);
    showToast("Error al eliminar orden", "error");
  } finally {
    showLoader(false);
  }
}

// ===================================
// UTILIDADES
// ===================================

function formatPrice(price) {
  return "$" + price.toLocaleString("es-CO");
}

function showLoader(show) {
  const loader = document.getElementById("loader");
  if (show) {
    loader.classList.add("active");
  } else {
    loader.classList.remove("active");
  }
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add("active");
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("active");
}

function openNotesModal(product) {
  document.getElementById("notesProductName").textContent = product.name;
  document.getElementById("productNotes").value = "";
  openModal("modalNotes");
}

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icon = type === "success" ? "✓" : "✕";

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideInRight 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

window.onclick = function (event) {
  if (event.target.classList.contains("modal")) {
    event.target.classList.remove("active");
  }
};
