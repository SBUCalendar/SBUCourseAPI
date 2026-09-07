using System.ComponentModel.DataAnnotations;

namespace SBUAPI.Models;

public sealed class BehestanSessionInput
{
    [Required]
    [StringLength(4096)]
    public string PCookie { get; set; } = "";

    [Required]
    [StringLength(2048)]
    public string Sid { get; set; } = "";

    [Required]
    [StringLength(2048)]
    public string Ticket { get; set; } = "";

    [Required]
    [StringLength(128)]
    public string Seq { get; set; } = "";
}
