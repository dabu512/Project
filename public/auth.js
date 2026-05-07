// logic, xử lý đăng nhập/ đăng ký
// public/auth.js
function toggleAuth(isReg) {
  document.getElementById("login-form").style.display = isReg
    ? "none"
    : "block";
  document.getElementById("register-form").style.display = isReg
    ? "block"
    : "none";
  document.getElementById("auth-title").innerText = isReg
    ? "Đăng ký"
    : "Đăng nhập";
}

function handleLogin() {
  const username = document.getElementById("l-user").value;
  const password = document.getElementById("l-pass").value;

  fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        localStorage.setItem("user", JSON.stringify(data.user));
        location.reload();
      } else {
        Swal.fire({
          icon: "error",
          title: "Thất bại",
          text: "Tài khoản hoặc mật khẩu không đúng!",
          timer: 2000,
        });
      }
    });
}

function handleRegister() {
  const body = {
    username: document.getElementById("r-user").value,
    password: document.getElementById("r-pass").value,
    fullName: document.getElementById("r-name").value,
    role: document.getElementById("r-role").value,
  };

  fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((res) => res.json())
    .then((data) => {
      Swal.fire({
        icon: data.success ? "success" : "error",
        title: data.success ? "Thành công" : "Thất bại",
        text: data.message,
        timer: data.success ? 2000 : 4000,
        showConfirmButton: !data.success,
      });

      if (data.success) toggleAuth(false);
    });
}

function checkLogin() {
  const user = JSON.parse(localStorage.getItem("user"));
  if (user) {
    document.getElementById("auth-overlay").style.display = "none";
    document.getElementById("user-info").innerHTML =
      `Chào, <b>${user.full_name}</b> (${user.role}) | <a href="#" onclick="logout()">Thoát</a>`;
    return user;
  }
  return null;
}

function logout() {
  localStorage.removeItem("user");
  location.reload();
}
