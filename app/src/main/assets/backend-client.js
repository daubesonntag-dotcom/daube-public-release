(() => {
  const API_PATH = "/api/v1/quest";
  const HEALTH_PATH = "/api/ecosystem/status";
  const ENDPOINT_KEY = "daube-backend-url";
  const HISTORY_KEY = "daube-chat-history";

  const byId = id => document.getElementById(id);
  const cleanBase = value => String(value || "").trim().replace(/\/$/, "");
  const getBase = () => cleanBase(localStorage.getItem(ENDPOINT_KEY));
  const setBase = value => localStorage.setItem(ENDPOINT_KEY, cleanBase(value));

  function consoleBox() {
    return byId("console") || byId("log");
  }

  function setStatus(text) {
    const live = byId("live") || byId("status");
    if (live) live.textContent = text;
  }

  function setSystemState(text) {
    const system = byId("systemState");
    if (system) system.textContent = text;
  }

  function setBusy(busy) {
    const launch = byId("launch");
    const doctor = byId("doctor");
    if (launch) launch.disabled = busy;
    if (doctor) doctor.disabled = busy;
    document.body.classList.toggle("is-busy", busy);
    if (busy) setSystemState("Đang gửi");
  }

  function appendConsole(text) {
    const box = consoleBox();
    if (!box) return;
    box.textContent = text;
  }

  function readHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function addHistory(role, text) {
    const history = readHistory();
    history.push({ role, text, at: new Date().toISOString() });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-40)));
    updateHistoryMetric();
  }

  function updateHistoryMetric() {
    const value = byId("historyCount");
    if (value) value.textContent = String(readHistory().length);
  }

  async function askBackend(message, mode = "chat") {
    const base = getBase();
    if (!base) throw new Error("BACKEND_NOT_CONFIGURED");

    const response = await fetch(base + API_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DAUBE-CLIENT": "android"
      },
      body: JSON.stringify({ message, mode })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `HTTP_${response.status}`);
    return data;
  }

  async function testBackend(showResult = true) {
    const base = getBase();
    const endpoint = byId("endpointValue");
    if (endpoint) endpoint.textContent = base || "Chưa cấu hình";

    if (!base) {
      setStatus("● CHƯA KẾT NỐI");
      setSystemState("Chưa kết nối");
      if (showResult) appendConsole("Chưa có Backend URL. Mở Settings → Kết nối AI để cấu hình endpoint HTTPS.");
      return false;
    }

    setStatus("● ĐANG KIỂM TRA");
    setSystemState("Đang kiểm tra");
    try {
      const response = await fetch(base + HEALTH_PATH, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      const ok = response.ok && data?.ok === true;
      if (ok) {
        setStatus("● AI ONLINE");
        setSystemState("Online");
        if (showResult) appendConsole(`Backend online: ${base}`);
        return true;
      }
      setStatus("● BACKEND OFFLINE");
      setSystemState("Offline");
      if (showResult) appendConsole(`Backend chưa xác nhận trạng thái sẵn sàng: ${base}`);
      return false;
    } catch (error) {
      setStatus("● BACKEND OFFLINE");
      setSystemState("Offline");
      if (showResult) appendConsole(`Không kết nối được backend: ${base}\n${String(error?.message || error)}`);
      return false;
    }
  }

  async function submitRealQuest(message, mode = "chat") {
    const text = String(message || "").trim();
    if (!text) {
      appendConsole("Nhập nội dung nhiệm vụ trước khi gửi.");
      return;
    }

    if (!getBase()) {
      setStatus("● CHƯA KẾT NỐI");
      setSystemState("Chưa kết nối");
      appendConsole("Nhiệm vụ chưa được gửi. Hãy cấu hình Backend URL HTTPS trong Settings trước.");
      return;
    }

    addHistory("user", text);
    setBusy(true);
    setStatus("● ĐANG GỬI");
    appendConsole(`Founder → ${text}\n\nĐang chờ phản hồi xác thực từ backend...`);

    try {
      const data = await askBackend(text, mode);
      const answer = data?.text?.trim();
      if (!answer) throw new Error("EMPTY_BACKEND_RESPONSE");
      addHistory("assistant", answer);
      appendConsole(`Founder → ${text}\n\nGrand Steward →\n${answer}`);
      setStatus("● AI ONLINE");
      setSystemState("Online");
    } catch (error) {
      const code = String(error?.message || error);
      appendConsole(
        `Founder → ${text}\n\nBackend chưa xác nhận thực thi. Lỗi: ${code}\n` +
        "Nội dung người dùng được giữ trong lịch sử cục bộ; không có trạng thái hoàn thành nào được tự tạo."
      );
      setStatus("● BACKEND ERROR");
      setSystemState("Lỗi backend");
    } finally {
      setBusy(false);
    }
  }

  function showHistory() {
    const items = readHistory();
    appendConsole(items.length
      ? items.map(item => `${item.role === "user" ? "Founder" : "Grand Steward"}: ${item.text}`).join("\n\n")
      : "Chưa có lịch sử trò chuyện.");
  }

  function addConnectionControls() {
    const target = byId("connectionControls");
    if (!target || byId("connect-ai")) return;

    const connect = document.createElement("button");
    connect.id = "connect-ai";
    connect.type = "button";
    connect.innerHTML = "Kết nối AI<small>Nhập Backend URL HTTPS</small>";
    connect.onclick = async () => {
      const current = getBase();
      const value = prompt("Nhập Backend URL HTTPS của D'AUBE Nexus", current || "");
      if (value === null) return;
      setBase(value);
      await testBackend(true);
    };

    const test = document.createElement("button");
    test.id = "test-ai";
    test.type = "button";
    test.innerHTML = "Kiểm tra kết nối<small>Đọc /api/ecosystem/status</small>";
    test.onclick = () => testBackend(true);

    const history = document.createElement("button");
    history.id = "chat-history";
    history.type = "button";
    history.innerHTML = "Lịch sử trò chuyện<small>Lưu cục bộ trên thiết bị</small>";
    history.onclick = showHistory;

    target.append(connect, test, history);
  }

  function wireActions() {
    const launch = byId("launch");
    const command = byId("command");
    if (launch && command) launch.onclick = () => submitRealQuest(command.value, "chat");

    const doctor = byId("doctor");
    if (doctor) doctor.onclick = () => submitRealQuest("Doctor scan toàn hệ thống, xác định lỗi và đề xuất cách vá an toàn.", "doctor");

    document.querySelectorAll("[data-quick]").forEach(button => {
      button.onclick = () => {
        const prompts = {
          build: "Lập kế hoạch build app và kiểm tra đầu ra.",
          design: "Đề xuất phương án UI/UX nhất quán với D’AUBE SONNTAG và nêu rõ bằng chứng cần để nghiệm thu.",
          sync: "Kiểm tra và lập kế hoạch đồng bộ ecosystem web, Android và Windows.",
          deploy: "Chuẩn bị kế hoạch deploy production an toàn và chỉ báo trạng thái dựa trên bằng chứng thực.",
          scan: "Quét repo và phân tích tình trạng hệ thống, không tự suy diễn trạng thái hoàn thành."
        };
        submitRealQuest(prompts[button.dataset.quick] || button.textContent, button.dataset.quick || "chat");
      };
    });

    document.querySelectorAll("[data-tool]").forEach(button => {
      button.onclick = () => submitRealQuest(button.dataset.prompt || button.textContent.trim(), "plan");
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    addConnectionControls();
    wireActions();
    updateHistoryMetric();
    await testBackend(false);
  });
})();
