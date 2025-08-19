import requests
import re
import time
import json

def get_pokemon_data(pokemon_id):
    
    url = f"https://pokeapi.co/api/v2/pokemon/{pokemon_id}"
    try:
        response = requests.get(url, timeout=15)
    except requests.RequestException as e:
        print(f"Request error for ID {pokemon_id}: {e}")
        return None

    if response.status_code != 200:
        print(f"Error fetching data for ID {pokemon_id}: {response.status_code}")
        return None

    data = response.json()

    pokemon = {
        "id": data["id"],
        "name": data["name"],
        "height": data["height"] / 10,
        "weight": data["weight"] / 10,
        "types": get_pokemon_types(data),
        "generation": get_pokemon_gen(data),
        "img_url": get_img_url(data)

    }
    return pokemon


def get_pokemon_gen(data):
    species_url = data["species"]["url"]
    try:
        response = requests.get(species_url)
    except requests.RequestException as e:
        print(f"Request error for species: {e}")
        return None
    
    if response.status_code != 200:
        print(f"Error fetching species data: {response.status_code}")
        return None
    
    subdata = response.json()
    gen_url = subdata["generation"]["url"]


    match = re.search(r"/generation/(\d+)/?", gen_url)
    if match:
        return int(match.group(1))
 
    else:
        return None

def get_pokemon_types(data):
        return [t["type"]["name"] for t in data["types"]]

def get_img_url(data):
    return data["sprites"]["front_default"]
    
def get_max_id():
    url = "https://pokeapi.co/api/v2/pokemon-species?limit=0"
    try:
        response = requests.get(url)
    except requests.RequestException as e:
        print(f"Error finding max count: {e}")

    if response.status_code != 200:
        print("Error finding max pokemon count")
        return 1025
    
    data = response.json()
    return data["count"]


if __name__ == "__main__":
    pokedex = {}
    MAX_ID = get_max_id()

    for i in range(1, MAX_ID + 1): 
        for attempt in range(3):
            pokemon = get_pokemon_data(i)
            if pokemon:
                pokedex[pokemon["id"]] = pokemon
                print(pokemon)
                break
            time.sleep(.2)

    with open("pokedex.json", "w", encoding="utf-8") as f:
        json.dump(pokedex, f, indent=4, ensure_ascii=False)
    print(f"saved {MAX_ID} pokemon")
        