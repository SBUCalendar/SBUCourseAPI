using System.ComponentModel.DataAnnotations;

namespace SBUAPI.Models;

public sealed class AdminLoginViewModel
{
    [Required(ErrorMessage = "نام کاربری را وارد کنید.")]
    [StringLength(128)]
    [Display(Name = "نام کاربری")]
    public string Username { get; set; } = "";

    [Required(ErrorMessage = "رمز عبور را وارد کنید.")]
    [StringLength(512)]
    [DataType(DataType.Password)]
    [Display(Name = "رمز عبور")]
    public string Password { get; set; } = "";

    public string? ReturnUrl { get; set; }
}
