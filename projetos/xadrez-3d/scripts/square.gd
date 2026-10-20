class_name Square
extends StaticBody3D

## Uma casa do tabuleiro 8x8.
## Convenção: coord = Vector2i(file, rank) | file 0..7 -> a..h | rank 0..7 -> 8..1
## Mundo: X = file (oeste -> leste), Z = rank (fundo -> frente), Y = cima.
## Centro do tabuleiro na origem (0, 0, 0).

enum Highlight { NONE, SELECTED, MOVE, CAPTURE }

const SIZE := 1.0
const THICKNESS := 0.14
const COLLISION_LAYER := 1  # bit 0 -> "squares" (ver layer_names no project.godot)
const HIGHLIGHT_ENERGY := 0.85

const HIGHLIGHT_COLORS := {
	Highlight.NONE: Color("000000"),
	Highlight.SELECTED: Color("f6f76b"),
	Highlight.MOVE: Color("6bd97a"),
	Highlight.CAPTURE: Color("e8604c"),
}

var coord := Vector2i.ZERO
var is_light := true
var highlight: Highlight = Highlight.NONE

var _mesh: MeshInstance3D
var _material: StandardMaterial3D


func _ready() -> void:
	collision_layer = COLLISION_LAYER
	collision_mask = 0
	add_to_group("squares")


## Chamado pelo BoardBuilder antes de entrar na árvore.
## Mesh e Shape são compartilhados entre as 64 casas (1 recurso de cada).
func setup(p_coord: Vector2i, p_is_light: bool, shared_mesh: BoxMesh,
		shared_shape: BoxShape3D, light_color: Color, dark_color: Color) -> void:
	coord = p_coord
	is_light = p_is_light
	name = algebraic()
	position = coord_to_world(coord)

	_material = StandardMaterial3D.new()
	_material.albedo_color = light_color if is_light else dark_color
	_material.roughness = 0.82
	_material.metallic = 0.0

	_mesh = MeshInstance3D.new()
	_mesh.name = "Mesh"
	_mesh.mesh = shared_mesh
	_mesh.material_override = _material
	add_child(_mesh)

	var col := CollisionShape3D.new()
	col.name = "Collision"
	col.shape = shared_shape
	add_child(col)


func set_highlight(mode: Highlight) -> void:
	highlight = mode
	if _material == null:
		return

	var on := mode != Highlight.NONE
	_material.emission_enabled = on
	if on:
		_material.emission = HIGHLIGHT_COLORS[mode] as Color
		_material.emission_energy_multiplier = HIGHLIGHT_ENERGY


func algebraic() -> String:
	return "abcdefgh"[coord.x] + str(8 - coord.y)


static func coord_to_world(p_coord: Vector2i) -> Vector3:
	return Vector3((p_coord.x - 3.5) * SIZE, 0.0, (p_coord.y - 3.5) * SIZE)
